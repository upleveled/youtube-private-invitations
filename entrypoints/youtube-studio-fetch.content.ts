/// <reference types="wxt/vite-builder-env" />
import { defineContentScript } from 'wxt/utils/define-content-script';

const metadataUpdatePath = '/youtubei/v1/video_manager/metadata_update';
const getCreatorVideosPath = '/youtubei/v1/creator/get_creator_videos';
const listCreatorVideosPath = '/youtubei/v1/creator/list_creator_videos';

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: MetadataUpdateBody;
};

type MetadataUpdateBody = {
  encryptedVideoId?: string;
  privacyState?: { newPrivacy?: string };
  privateShare?: {
    // Never set: leaving notifyViaEmail unset keeps invitee email notifications off
    notifyViaEmail?: never;
    shareEmails?: string;
    deletedOgids?: string;
    deletedEmails?: string;
  };
  [key: string]: unknown;
};

type MetadataUpdateCapture = {
  request: CapturedRequest;
  response: unknown;
};

type ReplayTarget = {
  videoId: string;
  shareEmails?: string;
  deletedOgids?: string;
  deletedEmails?: string;
};

type PrivateShareTarget = {
  shareGaiaTarget?: {
    emailAddress?: string;
    obfuscatedGaiaId?: string;
  };
  shareEmailTarget?: {
    emailAddress?: string;
  };
};

type MetadataUpdateResponse = {
  overallResult?: { resultCode?: string };
  privateShare?: { success?: boolean };
  creatorEntities?: {
    wrappedVideoData?: {
      video?: {
        privateShare?: { privateShareTargets?: PrivateShareTarget[] };
      };
    };
  };
};

type ApplyResult = {
  videoId: string;
  added: string[];
  removed: string[];
  skipped: boolean;
  error?: string;
};

type Invitee = {
  email: string | null;
  ogid: string | null;
};

type GetCreatorVideosResponse = {
  videos?: {
    videoId?: string;
    privacy?: string;
    privateShare?: { privateShareTargets?: PrivateShareTarget[] };
  }[];
};

function targetEmail(target: PrivateShareTarget) {
  return (
    target.shareGaiaTarget?.emailAddress ??
    target.shareEmailTarget?.emailAddress ??
    null
  );
}

function parseYoutubeiJson(text: string): unknown {
  // Some InnerTube responses are prefixed with )]}' to prevent JSON hijacking
  return JSON.parse(text.replace(/^\)\]\}'\n?/u, ''));
}

function headersToObject(headers: Headers) {
  const result: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    result[key] = value;
  }

  return result;
}

export default defineContentScript({
  matches: ['https://studio.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const originalFetch = window.fetch;
    let lastCapture: MetadataUpdateCapture | null = null;
    let lastReadContext: {
      headers: Record<string, string>;
      context: unknown;
    } | null = null;

    function captureMetadataUpdate(
      request: CapturedRequest,
      responseText: string,
    ) {
      const responseBody = parseYoutubeiJson(responseText);

      // Title and privacy edits hit the same endpoint, so only keep private-share captures
      if (request.body.privateShare) {
        lastCapture = { request, response: responseBody };
      }
    }

    // get_creator_videos and list_creator_videos are reads without botguard, so reuse their auth and context to read any video
    function captureReadContext(headers: Record<string, string>, body: string) {
      const context = (JSON.parse(body) as { context?: unknown }).context;

      if (context) {
        lastReadContext = { headers, context };
      }
    }

    // Studio sends InnerTube calls over XMLHttpRequest, so capture and record from there
    const xhrCaptures = new WeakMap<
      XMLHttpRequest,
      { method: string; url: string; headers: Record<string, string>; body: string }
    >();
    const originalOpen = XMLHttpRequest.prototype.open as (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) => void;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function xhrOpenWithCapture(
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null,
    ) {
      xhrCaptures.set(this, {
        method,
        url: String(url),
        headers: {},
        body: '',
      });
      return originalOpen.call(this, method, url, async, username, password);
    };

    XMLHttpRequest.prototype.setRequestHeader = function xhrSetHeaderWithCapture(
      name: string,
      value: string,
    ) {
      const capture = xhrCaptures.get(this);

      if (capture) {
        capture.headers[name] = value;
      }

      return originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function xhrSendWithCapture(
      ...args: Parameters<typeof originalSend>
    ) {
      const capture = xhrCaptures.get(this);

      if (capture && typeof args[0] === 'string') {
        capture.body = args[0];
      }

      this.addEventListener('load', () => {
        if (!capture) {
          return;
        }

        try {
          if (capture.url.includes(metadataUpdatePath)) {
            captureMetadataUpdate(
              {
                url: capture.url,
                method: capture.method,
                headers: capture.headers,
                body: JSON.parse(capture.body) as MetadataUpdateBody,
              },
              this.responseText,
            );
          } else if (
            capture.url.includes(getCreatorVideosPath) ||
            capture.url.includes(listCreatorVideosPath)
          ) {
            captureReadContext(capture.headers, capture.body);
          }
        } catch (error) {
          console.error(
            '[youtube-private-invitations] failed to capture request',
            error,
          );
        }
      });

      return originalSend.apply(this, args);
    };

    window.fetch = async function fetchWithCapture(input, init) {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      const response = await originalFetch.call(this, input, init);

      // Capture must never break Studio's own request, so swallow capture errors
      try {
        if (url.includes(metadataUpdatePath)) {
          const request = new Request(input, init);
          captureMetadataUpdate(
            {
              url,
              method: request.method,
              headers: headersToObject(request.headers),
              body: JSON.parse(
                await request.clone().text(),
              ) as MetadataUpdateBody,
            },
            await response.clone().text(),
          );
        } else if (
          url.includes(getCreatorVideosPath) ||
          url.includes(listCreatorVideosPath)
        ) {
          const request = new Request(input, init);
          captureReadContext(
            headersToObject(request.headers),
            await request.clone().text(),
          );
        }
      } catch (error) {
        console.error(
          '[youtube-private-invitations] failed to capture request',
          error,
        );
      }

      return response;
    };

    async function replay(target: ReplayTarget) {
      if (!lastCapture) {
        throw new Error('No captured metadata_update request yet');
      }

      const body = structuredClone(lastCapture.request.body);

      // Replay only the body shape observed from the share dialog's own save - if Studio ever
      // batches extra fields into the capture, fail loudly instead of stamping the seed video's
      // values onto every other video
      const knownBodyKeys = [
        'context',
        'encryptedVideoId',
        'videoReadMask',
        'privacyState',
        'privateShare',
        'attestationResponseData',
      ];
      const unknownBodyKeys = Object.keys(body).filter((key) => {
        return !knownBodyKeys.includes(key);
      });

      if (unknownBodyKeys.length > 0) {
        throw new Error(
          `Captured metadata_update has unreviewed fields: ${unknownBodyKeys.join(', ')}`,
        );
      }

      // Applying to validated-private videos makes replaying newPrivacy PRIVATE a no-op
      if (body.privacyState?.newPrivacy !== 'PRIVATE') {
        throw new Error(
          `Captured metadata_update privacyState is not PRIVATE: ${JSON.stringify(body.privacyState)}`,
        );
      }

      body.encryptedVideoId = target.videoId;

      // Build privateShare only from the target so a captured removal never leaks into an add
      body.privateShare = {};

      if (target.shareEmails !== undefined) {
        body.privateShare.shareEmails = target.shareEmails;
      }

      if (target.deletedOgids !== undefined) {
        body.privateShare.deletedOgids = target.deletedOgids;
      }

      if (target.deletedEmails !== undefined) {
        body.privateShare.deletedEmails = target.deletedEmails;
      }

      const response = await originalFetch(lastCapture.request.url, {
        method: lastCapture.request.method,
        headers: lastCapture.request.headers,
        body: JSON.stringify(body),
        credentials: 'include',
      });

      return {
        status: response.status,
        body: (await response.json()) as MetadataUpdateResponse,
      };
    }

    // Read current invitees for any video ids via get_creator_videos, which needs no botguard attestation
    async function readVideos(videoIds: string[]) {
      if (!lastReadContext) {
        throw new Error('No captured read context yet');
      }

      const response = await originalFetch(
        `${getCreatorVideosPath}?alt=json`,
        {
          method: 'POST',
          headers: lastReadContext.headers,
          body: JSON.stringify({
            context: lastReadContext.context,
            videoIds,
            mask: { videoId: true, privacy: true, privateShare: { all: true } },
            failOnError: true,
            criticalRead: false,
          }),
          credentials: 'include',
        },
      );
      const parsed = (await response.json()) as GetCreatorVideosResponse;

      const map: Record<string, { privacy?: string; invitees: Invitee[] }> = {};

      for (const video of parsed.videos ?? []) {
        if (!video.videoId) {
          continue;
        }

        map[video.videoId] = {
          privacy: video.privacy,
          invitees: (video.privateShare?.privateShareTargets ?? []).map(
            (target) => {
              return {
                email: targetEmail(target),
                ogid: target.shareGaiaTarget?.obfuscatedGaiaId ?? null,
              };
            },
          ),
        };
      }

      return map;
    }

    // The seed video's native Save closes its dialog optimistically, so wait for its metadata_update capture to land
    async function waitForCapture() {
      const deadline = Date.now() + 10000;

      while (!lastCapture) {
        if (Date.now() > deadline) {
          return false;
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 100);
        });
      }

      return true;
    }

    // Apply add/remove invitee deltas to each video via one metadata_update replay per video
    async function applyInvitees(target: {
      videoIds: string[];
      addEmails: string[];
      removeEmails: string[];
    }) {
      const map = await readVideos(target.videoIds);

      if (!(await waitForCapture())) {
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
              return invitee.email?.toLowerCase() === addEmail.toLowerCase();
            });
          });

          // Resolved Google accounts are removed by ogid, pending email invites by email
          const deletedOgids: string[] = [];
          const deletedEmails: string[] = [];
          const removedEmails: string[] = [];

          for (const removeEmail of target.removeEmails) {
            const invitee = invitees.find((candidate) => {
              return (
                candidate.email?.toLowerCase() === removeEmail.toLowerCase()
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

          const { body } = await replay({
            videoId,
            shareEmails: addEmails.length > 0 ? addEmails.join(',') : undefined,
            deletedOgids:
              deletedOgids.length > 0 ? deletedOgids.join(',') : undefined,
            deletedEmails:
              deletedEmails.length > 0 ? deletedEmails.join(',') : undefined,
          });

          // A non-UPDATE_SUCCESS resultCode or failed privateShare is an outright failure, even
          // when the returned list happens to match
          if (
            body.overallResult?.resultCode !== 'UPDATE_SUCCESS' ||
            body.privateShare?.success !== true
          ) {
            throw new Error(
              `Update failed for ${videoId} (${body.overallResult?.resultCode}, privateShare success: ${body.privateShare?.success})`,
            );
          }

          // resultCode UPDATE_SUCCESS can still lie, so verify each change against the invitee list the server returns
          const resultingEmails = new Set(
            (
              body.creatorEntities?.wrappedVideoData?.video?.privateShare
                ?.privateShareTargets ?? []
            )
              .map((resultingTarget) => {
                return targetEmail(resultingTarget)?.toLowerCase();
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
              `Update failed for ${videoId} (${body.overallResult.resultCode})${
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

      if (data.source !== 'youtube-private-invitations-isolated') {
        return;
      }

      const requestId = data.requestId;

      // Drop any stale capture before the next seed so waitForCapture cannot resolve on an old one
      if (data.type === 'reset') {
        lastCapture = null;
        window.postMessage(
          {
            source: 'youtube-private-invitations-main',
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
          const captured = await waitForCapture();
          const response = captured
            ? (lastCapture?.response as MetadataUpdateResponse | undefined)
            : undefined;

          window.postMessage(
            {
              source: 'youtube-private-invitations-main',
              type: 'seed-status-result',
              requestId,
              ok:
                response?.overallResult?.resultCode === 'UPDATE_SUCCESS' &&
                response.privateShare?.success === true,
              resultCode: response?.overallResult?.resultCode,
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
              source: 'youtube-private-invitations-main',
              type: 'apply-result',
              requestId,
              results,
            },
            window.location.origin,
          );
        } catch (error) {
          window.postMessage(
            {
              source: 'youtube-private-invitations-main',
              type: 'apply-error',
              requestId,
              message: error instanceof Error ? error.message : String(error),
            },
            window.location.origin,
          );
        } finally {
          // Discard the captured write template so its attestation cannot be reused later
          lastCapture = null;
        }
      })().catch((error: unknown) => {
        console.error(error);
      });
    });
  },
});
