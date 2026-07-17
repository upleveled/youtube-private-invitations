/// <reference types="wxt/vite-builder-env" />
import { defineContentScript } from 'wxt/utils/define-content-script';

import {
  captureStudioInnertubeRequests,
  getPrivateShareTargetEmail,
} from '../util/youtubeStudio.js';

const isolatedMessageSource = 'youtube-private-invitations-isolated';
const mainWorldMessageSource = 'youtube-private-invitations-main';

export default defineContentScript({
  matches: ['https://studio.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const studioRequests = captureStudioInnertubeRequests();

    type ApplyResult = {
      videoId: string;
      added: string[];
      removed: string[];
      skipped: boolean;
      error?: string;
    };

    // Apply add/remove invitee deltas to each video via one metadata_update replay per video
    async function applyInvitees(target: {
      videoIds: string[];
      addEmails: string[];
      removeEmails: string[];
    }) {
      const map = await studioRequests.readPrivateShareVideos(target.videoIds);

      if (!(await studioRequests.waitForMetadataUpdateCapture())) {
        throw new Error('No captured metadata_update request yet');
      }

      const results: ApplyResult[] = [];

      for (const [index, videoId] of target.videoIds.entries()) {
        // Record each video's outcome, then stop on the first failure instead of throwing
        try {
          const video = map[videoId];

          if (!video) {
            throw new Error(`Could not read current invitees for ${videoId}`);
          }

          // Private-share invitees only exist on private videos, so refuse anything else
          if (video.privacy !== 'VIDEO_PRIVACY_PRIVATE') {
            throw new Error(`${videoId} is not private`);
          }

          const invitees = video.invitees;

          const addEmails = target.addEmails.filter((addEmail) => {
            return !invitees.some((invitee) => {
              return (
                invitee.email !== null &&
                invitee.email.toLowerCase() === addEmail.toLowerCase()
              );
            });
          });

          // Resolved Google accounts are removed by ogid, pending email invites by email
          const deletedOgids: string[] = [];
          const deletedEmails: string[] = [];
          const removedEmails: string[] = [];

          for (const removeEmail of target.removeEmails) {
            const invitee = invitees.find((candidate) => {
              return (
                candidate.email !== null &&
                candidate.email.toLowerCase() === removeEmail.toLowerCase()
              );
            });

            if (!invitee) {
              continue;
            }

            removedEmails.push(removeEmail);

            if (invitee.ogid) {
              deletedOgids.push(invitee.ogid);
            } else if (invitee.email) {
              deletedEmails.push(invitee.email);
            }
          }

          if (
            addEmails.length === 0 &&
            deletedOgids.length === 0 &&
            deletedEmails.length === 0
          ) {
            results.push({ videoId, added: [], removed: [], skipped: true });
            continue;
          }

          if (index > 0) {
            await new Promise<void>((resolve) => {
              window.setTimeout(
                resolve,
                1000 + Math.floor(Math.random() * 2000),
              );
            });
          }

          const { body } = await studioRequests.replayMetadataUpdate({
            videoId,
            shareEmails: addEmails.length > 0 ? addEmails.join(',') : undefined,
            deletedOgids:
              deletedOgids.length > 0 ? deletedOgids.join(',') : undefined,
            deletedEmails:
              deletedEmails.length > 0 ? deletedEmails.join(',') : undefined,
          });

          // A non-UPDATE_SUCCESS resultCode or failed privateShare is an outright failure, even
          // when the returned list happens to match
          const overallResult = body.overallResult;
          const privateShare = body.privateShare;

          if (
            !overallResult ||
            overallResult.resultCode !== 'UPDATE_SUCCESS' ||
            !privateShare ||
            privateShare.success !== true
          ) {
            throw new Error(
              `Update failed for ${videoId} (${overallResult ? overallResult.resultCode : 'no resultCode'}, privateShare success: ${privateShare ? String(privateShare.success) : 'missing'})`,
            );
          }

          // resultCode UPDATE_SUCCESS can still lie, so verify each change against the invitee list the server returns
          const creatorEntities = body.creatorEntities;
          const privateShareTargets =
            creatorEntities &&
            creatorEntities.wrappedVideoData &&
            creatorEntities.wrappedVideoData.video &&
            creatorEntities.wrappedVideoData.video.privateShare &&
            creatorEntities.wrappedVideoData.video.privateShare.privateShareTargets
              ? creatorEntities.wrappedVideoData.video.privateShare
                .privateShareTargets
              : [];

          const resultingEmails = new Set(
            privateShareTargets
              .map((resultingTarget) => {
                const email = getPrivateShareTargetEmail(resultingTarget);
                return email ? email.toLowerCase() : undefined;
              })
              .filter((email) => email !== undefined),
          );

          const failedAdds = addEmails.filter((addEmail) => {
            return !resultingEmails.has(addEmail.toLowerCase());
          });
          const failedRemoves = removedEmails.filter((removeEmail) => {
            return resultingEmails.has(removeEmail.toLowerCase());
          });

          if (failedAdds.length > 0 || failedRemoves.length > 0) {
            throw new Error(
              `Update failed for ${videoId} (${overallResult.resultCode})${
                failedAdds.length > 0
                  ? ` - could not add: ${failedAdds.join(', ')}`
                  : ''
              }${
                failedRemoves.length > 0
                  ? ` - could not remove: ${failedRemoves.join(', ')}`
                  : ''
              }`,
            );
          }

          results.push({
            videoId,
            added: addEmails,
            removed: removedEmails,
            skipped: false,
          });
        } catch (error) {
          results.push({
            videoId,
            added: [],
            removed: [],
            skipped: false,
            error: error instanceof Error ? error.message : String(error),
          });
          // Stop on the first failure so we do not keep hammering with invalid data
          break;
        }
      }

      return results;
    }

    // Apply invitee changes requested by the isolated content script over the InnerTube API.
    // Only same-window, same-origin messages are accepted. Any code that could forge one already
    // runs in Studio's page context and can call metadata_update directly, so this adds no
    // capability; the captured write template is still discarded after each apply to bound reuse.
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as {
        source?: string;
        type?: string;
        requestId?: string;
        videoIds?: unknown;
        addEmails?: unknown;
        removeEmails?: unknown;
      };

      if (data.source !== isolatedMessageSource) {
        return;
      }

      const requestId = data.requestId;

      // Drop any stale capture before the next seed so waitForMetadataUpdateCapture cannot resolve on an old one
      if (data.type === 'reset') {
        studioRequests.resetLastMetadataUpdateCapture();
        window.postMessage(
          {
            source: mainWorldMessageSource,
            type: 'reset-result',
            requestId,
          },
          window.location.origin,
        );
        return;
      }

      // Report whether the seed video's captured metadata_update actually succeeded server-side
      if (data.type === 'seed-status') {
        (async () => {
          const seedStatus = await studioRequests.getMetadataUpdateStatus();

          window.postMessage(
            {
              source: mainWorldMessageSource,
              type: 'seed-status-result',
              requestId,
              ok: seedStatus.ok,
              resultCode: seedStatus.resultCode,
            },
            window.location.origin,
          );
        })().catch((error: unknown) => {
          console.error(error);
        });
        return;
      }

      if (data.type !== 'apply') {
        return;
      }

      (async () => {
        try {
          if (
            !Array.isArray(data.videoIds) ||
            !Array.isArray(data.addEmails) ||
            !Array.isArray(data.removeEmails)
          ) {
            throw new Error('Invalid private-share apply request');
          }

          const results = await applyInvitees({
            videoIds: data.videoIds as string[],
            addEmails: data.addEmails as string[],
            removeEmails: data.removeEmails as string[],
          });

          window.postMessage(
            {
              source: mainWorldMessageSource,
              type: 'apply-result',
              requestId,
              results,
            },
            window.location.origin,
          );
        } catch (error) {
          window.postMessage(
            {
              source: mainWorldMessageSource,
              type: 'apply-error',
              requestId,
              message: error instanceof Error ? error.message : String(error),
            },
            window.location.origin,
          );
        } finally {
          // Discard the captured write template so its attestation cannot be reused later
          studioRequests.resetLastMetadataUpdateCapture();
        }
      })().catch((error: unknown) => {
        console.error(error);
      });
    });
  },
});
