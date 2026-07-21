/* eslint-disable no-restricted-syntax -- Content script automation reads and edits YouTube Studio DOM */

import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import {
  assertStudioVideoRowStillMatchesVideo,
  initYoutubeStudio,
  findInviteeChip,
  getSelectedStudioVideos,
  isOpenPrivateShareDialog,
  isOpenVisibilityPopup,
  type StudioVideo,
} from '../util/youtubeStudio.js';

const buttonId = 'youtube-private-invitations-share-private';
const statusId = 'youtube-private-invitations-status';

type VideoInviteeChange = {
  video: StudioVideo;
  addedEmails: string[];
  removedEmails: string[];
  alreadyInvitedEmails: string[];
  notInvitedEmails: string[];
  error?: string;
};

// Injected into the MAIN world by youtube-studio.content.ts, so fetch/XHR patches hook Studio's own requests
export default defineUnlistedScript(() => {
  // The XHR and fetch patches must run before Studio's first InnerTube requests
  const youtubeStudio = initYoutubeStudio();

    // The UI waits for the DOM, which does not exist yet at document_start
    document.addEventListener('DOMContentLoaded', () => {
      addSharePrivatelyAction();

      new MutationObserver(addSharePrivatelyAction).observe(document.body, {
        childList: true,
        subtree: true,
      });
    });

    function addSharePrivatelyAction() {
      if (document.getElementById(buttonId)) {
        return;
      }

      const toolbar = document.querySelector('ytcp-bulk-actions .toolbar');

      if (!toolbar) {
        return;
      }

      const button = document.createElement('button');
      button.id = buttonId;
      button.className = 'label style-scope ytcp-bulk-actions';
      button.type = 'button';
      button.textContent = 'Share privately';
      toolbar.append(button);

      button.addEventListener('click', (event) => {
        if (!event.isTrusted) {
          return;
        }

        const videoInviteeChanges: VideoInviteeChange[] = [];

        void (async () => {
          try {
            button.disabled = true;

            const selectedVideos = getSelectedStudioVideos();

            const backdrop = document.createElement('div');
            backdrop.className = 'youtube-private-invitations-backdrop';
            const dialog = document.createElement('form');
            dialog.className = 'youtube-private-invitations-dialog';
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute(
              'aria-labelledby',
              'youtube-private-invitations-title',
            );
            const header = document.createElement('div');
            header.className = 'header style-scope ytcp-dialog';
            const headerContent = document.createElement('div');
            headerContent.className = 'header-content style-scope ytcp-dialog';
            const title = document.createElement('h1');
            title.id = 'youtube-private-invitations-title';
            title.className = 'style-scope ytcp-private-video-sharing-dialog';
            title.setAttribute('slot', 'primary-header');
            title.textContent = 'Share privately';
            headerContent.append(title);
            header.append(headerContent);

            const content = document.createElement('div');
            content.className = 'content style-scope ytcp-dialog';
            const targets = document.createElement('div');
            targets.className =
              'description-text style-scope ytcp-private-video-sharing-dialog youtube-private-invitations-targets';

            const addLabel = document.createElement('label');
            addLabel.className = 'youtube-private-invitations-field';
            const addLabelText = document.createElement('span');
            addLabelText.textContent = 'Add invitees (comma-separated)';
            const addTextarea = document.createElement('textarea');
            addTextarea.name = 'addEmails';
            addTextarea.autofocus = true;
            addLabel.append(addLabelText, addTextarea);

            const removeLabel = document.createElement('label');
            removeLabel.className = 'youtube-private-invitations-field';
            const removeLabelText = document.createElement('span');
            removeLabelText.textContent = 'Remove invitees (comma-separated)';
            const removeTextarea = document.createElement('textarea');
            removeTextarea.name = 'removeEmails';
            removeLabel.append(removeLabelText, removeTextarea);

            content.append(targets, addLabel, removeLabel);

            const footer = document.createElement('div');
            footer.className = 'footer style-scope ytcp-dialog';
            const footerButtons = document.createElement('div');
            footerButtons.className =
              'style-scope ytcp-private-video-sharing-dialog';
            footerButtons.setAttribute('slot', 'secondary-footer');
            const cancelButton = document.createElement('button');
            cancelButton.className =
              'ytcpButtonShapeImplHost ytcpButtonShapeImpl--tonal ytcpButtonShapeImpl--mono ytcpButtonShapeImpl--size-m ytcpButtonShapeImpl--enable-backdrop-filter-experiment';
            cancelButton.type = 'button';
            cancelButton.textContent = 'Cancel';
            const applyButton = document.createElement('button');
            applyButton.className =
              'ytcpButtonShapeImplHost ytcpButtonShapeImpl--filled ytcpButtonShapeImpl--mono ytcpButtonShapeImpl--size-m ytcpButtonShapeImpl--enable-backdrop-filter-experiment';
            applyButton.type = 'submit';
            applyButton.textContent = 'Apply';
            footerButtons.append(cancelButton, applyButton);
            footer.append(footerButtons);

            dialog.append(header, content, footer);

            targets.append(getVideoList(selectedVideos));
            document.documentElement.append(backdrop, dialog);

            const emailChanges = await new Promise<{
              addEmails: string[];
              removeEmails: string[];
            } | null>((resolve, reject) => {
              function getEmails(label: string, value: string) {
                const emails: string[] = [];
                const invalidTokens: string[] = [];

                for (const token of value.trim()
                  ? value.trim().split(/[\s,]+/u)
                  : []) {
                  if (
                    !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/iu.test(token)
                  ) {
                    invalidTokens.push(token);
                    continue;
                  }

                  if (
                    !emails.some((email) => {
                      return email.toLowerCase() === token.toLowerCase();
                    })
                  ) {
                    emails.push(token);
                  }
                }

                if (invalidTokens.length > 0) {
                  throw new Error(
                    `${label} contains invalid email tokens: ${invalidTokens.join(', ')}`,
                  );
                }

                return emails;
              }

              dialog.addEventListener('submit', (submitEvent) => {
                submitEvent.preventDefault();

                if (!submitEvent.isTrusted) {
                  reject(new Error('Synthetic private-share submit blocked'));
                  return;
                }

                try {
                  const addEmails = getEmails(
                    'Add invitees',
                    addTextarea.value,
                  );
                  const removeEmails = getEmails(
                    'Remove invitees',
                    removeTextarea.value,
                  );

                  const validationErrors: string[] = [];

                  if (addEmails.length === 0 && removeEmails.length === 0) {
                    validationErrors.push(
                      'Add or remove at least one invitee email address',
                    );
                  }

                  for (const addEmail of addEmails) {
                    if (
                      removeEmails.some((removeEmail) => {
                        return (
                          removeEmail.toLowerCase() === addEmail.toLowerCase()
                        );
                      })
                    ) {
                      validationErrors.push(
                        `Do not add and remove ${addEmail}`,
                      );
                    }
                  }

                  if (validationErrors.length > 0) {
                    const statusMessage = getStatusMessage(
                      'Fix invitee changes',
                    );
                    const statusList = document.createElement('ul');

                    for (const validationError of validationErrors) {
                      appendStatusOutcome(statusList, 'error', validationError);
                    }

                    statusMessage.append(statusList);
                    showStatus(statusMessage);
                    return;
                  }

                  resolve({ addEmails, removeEmails });
                } catch (error) {
                  const statusMessage = getStatusMessage('Fix invitee changes');
                  const statusList = document.createElement('ul');

                  appendStatusOutcome(
                    statusList,
                    'error',
                    error instanceof Error ? error.message : String(error),
                  );
                  statusMessage.append(statusList);
                  showStatus(statusMessage);
                }
              });
              cancelButton.addEventListener('click', () => {
                resolve(null);
              });
              // Match the native dialog: backdrop click and Escape both cancel
              backdrop.addEventListener('click', () => {
                resolve(null);
              });
              dialog.addEventListener('keydown', (keydownEvent) => {
                if (keydownEvent.key === 'Escape') {
                  resolve(null);
                }
              });
              addTextarea.focus();
            }).finally(() => {
              backdrop.remove();
              dialog.remove();
            });

            if (!emailChanges) {
              return;
            }

            // Drop any stale capture so the seed check reads this run's write template, not a previous one
            youtubeStudio.resetLastMetadataUpdateCapture();
            const privateShareVideos =
              await youtubeStudio.readPrivateShareVideos(
                selectedVideos.map((selectedVideo) => {
                  return selectedVideo.videoId;
                }),
              );

            // Drive the native dialog until one video actually changes, which seeds the API write template
            let seededIndex = -1;
            let seededVideo: (typeof selectedVideos)[number] | undefined;
            let seededVideoInviteeChange: VideoInviteeChange | undefined;
            let nativeDialogAttemptCount = 0;

            for (const [index, selectedVideo] of selectedVideos.entries()) {
              showStatus(`Applying ${index + 1}/${selectedVideos.length}`);

              try {
                assertStudioVideoRowStillMatchesVideo(
                  selectedVideo.row,
                  selectedVideo.videoId,
                );
              } catch (error) {
                throw getStatusError(
                  error instanceof Error ? error.message : String(error),
                  getVideoMessage(
                    'Selected video row changed for',
                    selectedVideo,
                  ),
                );
              }

              const privateShareVideo =
                privateShareVideos[selectedVideo.videoId];

              if (!privateShareVideo) {
                throw getStatusError(
                  `Could not read current invitees for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Could not read current invitees for',
                    selectedVideo,
                  ),
                );
              }

              if (privateShareVideo.privacy !== 'VIDEO_PRIVACY_PRIVATE') {
                throw getStatusError(
                  `${selectedVideo.videoId} is not private`,
                  getVideoMessage('Video is not private:', selectedVideo),
                );
              }

              const addEmailsToApply = emailChanges.addEmails.filter(
                (addEmail) => {
                  return !privateShareVideo.invitees.some((invitee) => {
                    return (
                      invitee.email !== null &&
                      invitee.email.toLowerCase() === addEmail.toLowerCase()
                    );
                  });
                },
              );
              const removeEmailsToApply = emailChanges.removeEmails.filter(
                (removeEmail) => {
                  return privateShareVideo.invitees.some((invitee) => {
                    return (
                      invitee.email !== null &&
                      invitee.email.toLowerCase() === removeEmail.toLowerCase()
                    );
                  });
                },
              );

              if (
                addEmailsToApply.length === 0 &&
                removeEmailsToApply.length === 0
              ) {
                videoInviteeChanges.push({
                  video: selectedVideo,
                  addedEmails: [],
                  removedEmails: [],
                  alreadyInvitedEmails: emailChanges.addEmails,
                  notInvitedEmails: emailChanges.removeEmails,
                });
                continue;
              }

              if (nativeDialogAttemptCount > 0) {
                await new Promise<void>((resolve) => {
                  window.setTimeout(
                    resolve,
                    300 + Math.floor(Math.random() * 1100),
                  );
                });
              }

              nativeDialogAttemptCount++;

              if (
                Array.from(
                  document.querySelectorAll<HTMLElement>(
                    'ytcp-dialog.ytcp-private-video-sharing-dialog, ytcp-dialog',
                  ),
                ).some(isOpenPrivateShareDialog)
              ) {
                throw new Error(
                  'Close the existing private-share dialog first',
                );
              }

              const visibilityControl = await getElement(
                () =>
                  selectedVideo.row.querySelector<HTMLElement>(
                    '.tablecell-visibility .edit-triangle-icon',
                  ),
                `visibility control for ${selectedVideo.videoId}`,
              ).catch(() => {
                throw getStatusError(
                  `Could not find visibility control for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Could not find visibility control for',
                    selectedVideo,
                  ),
                );
              });

              visibilityControl.click();

              const visibilityPopup = await getElement(
                () =>
                  Array.from(
                    document.querySelectorAll<HTMLElement>(
                      'ytcp-video-visibility-edit-popup',
                    ),
                  ).find(isOpenVisibilityPopup),
                `visibility popup for ${selectedVideo.videoId}`,
                getVideoMessage(
                  'Could not find visibility popup for',
                  selectedVideo,
                ),
              );

              const menuShareButton = await getElement(
                () =>
                  visibilityPopup.querySelector<HTMLElement>(
                    'ytcp-button.private-share-edit-button button',
                  ),
                `private-share button for ${selectedVideo.videoId}`,
                getVideoMessage(
                  'Could not find private-share button for',
                  selectedVideo,
                ),
              );

              menuShareButton.click();

              const nextDialog = await getElement(
                () =>
                  Array.from(
                    document.querySelectorAll<HTMLElement>(
                      'ytcp-dialog.ytcp-private-video-sharing-dialog',
                    ),
                  ).find(isOpenPrivateShareDialog),
                `YouTube private-share dialog for ${selectedVideo.videoId}`,
                getVideoMessage(
                  'Could not find YouTube private-share dialog for',
                  selectedVideo,
                ),
              );

              const videoInviteeChange: VideoInviteeChange = {
                video: selectedVideo,
                addedEmails: [],
                removedEmails: [],
                alreadyInvitedEmails: [],
                notInvitedEmails: [],
              };

              if (emailChanges.addEmails.length > 0) {
                const input = await getElement(
                  () =>
                    nextDialog.querySelector<HTMLInputElement>(
                      '#text-input[aria-label="Invitees"]',
                    ),
                  `private-share email input for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Could not find private-share email input for',
                    selectedVideo,
                  ),
                );
                const inputValueDescriptor = Object.getOwnPropertyDescriptor(
                  Object.getPrototypeOf(input),
                  'value',
                );

                if (!inputValueDescriptor || !inputValueDescriptor.set) {
                  throw getStatusError(
                    `Could not set the private-share email input value for ${selectedVideo.videoId}`,
                    getVideoMessage(
                      'Could not set the private-share email input value for',
                      selectedVideo,
                    ),
                  );
                }

                for (const addEmail of emailChanges.addEmails) {
                  if (findInviteeChip(nextDialog, addEmail)) {
                    videoInviteeChange.alreadyInvitedEmails.push(addEmail);
                    continue;
                  }

                  inputValueDescriptor.set.call(input, addEmail);
                  input.dispatchEvent(
                    new InputEvent('input', { bubbles: true }),
                  );
                  input.dispatchEvent(
                    new KeyboardEvent('keydown', {
                      bubbles: true,
                      code: 'Enter',
                      key: 'Enter',
                      keyCode: 13,
                      which: 13,
                    }),
                  );
                  input.dispatchEvent(
                    new KeyboardEvent('keyup', {
                      bubbles: true,
                      code: 'Enter',
                      key: 'Enter',
                      keyCode: 13,
                      which: 13,
                    }),
                  );
                  await getElement(
                    () => findInviteeChip(nextDialog, addEmail),
                    `private-share chip for ${addEmail} in ${selectedVideo.videoId}`,
                    getVideoMessage(
                      `Could not find private-share chip for ${addEmail} in`,
                      selectedVideo,
                    ),
                  );
                  videoInviteeChange.addedEmails.push(addEmail);
                }
              }

              for (const removeEmail of emailChanges.removeEmails) {
                const chip = findInviteeChip(nextDialog, removeEmail);

                if (!chip) {
                  videoInviteeChange.notInvitedEmails.push(removeEmail);
                  continue;
                }

                const deleteButton =
                  chip.querySelector<HTMLElement>('#delete-icon');

                if (!deleteButton) {
                  throw getStatusError(
                    `Could not remove ${removeEmail} from ${selectedVideo.videoId}`,
                    getVideoMessage(
                      `Could not remove ${removeEmail} from`,
                      selectedVideo,
                    ),
                  );
                }

                deleteButton.click();

                // dom-repeat reuses chip elements, so check aria-labels instead of the clicked chip
                await getElement(
                  () =>
                    findInviteeChip(nextDialog, removeEmail)
                      ? null
                      : nextDialog,
                  `removed chip for ${removeEmail} in ${selectedVideo.videoId}`,
                  getVideoMessage(
                    `Could not remove ${removeEmail} from`,
                    selectedVideo,
                  ),
                );
                videoInviteeChange.removedEmails.push(removeEmail);
              }

              if (
                videoInviteeChange.addedEmails.length === 0 &&
                videoInviteeChange.removedEmails.length === 0
              ) {
                const shareCancelButton = await getElement(
                  () =>
                    nextDialog.querySelector<HTMLElement>(
                      '#cancel-button button[aria-label="Cancel"]',
                    ),
                  `private-share Cancel button for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Could not find private-share Cancel button for',
                    selectedVideo,
                  ),
                );

                shareCancelButton.click();

                await getElement(
                  () =>
                    nextDialog.isConnected &&
                    isOpenPrivateShareDialog(nextDialog)
                      ? null
                      : nextDialog,
                  `closed private-share dialog for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Could not close private-share dialog for',
                    selectedVideo,
                  ),
                  10000,
                );

                const popupCancelButton = await getElement(
                  () =>
                    visibilityPopup.querySelector<HTMLElement>(
                      'ytcp-button#cancel-button button[aria-label="Cancel"]',
                    ),
                  `visibility popup Cancel button for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Could not find visibility popup Cancel button for',
                    selectedVideo,
                  ),
                );

                popupCancelButton.click();

                await getElement(
                  () =>
                    visibilityPopup.isConnected &&
                    isOpenVisibilityPopup(visibilityPopup)
                      ? null
                      : visibilityPopup,
                  `closed visibility popup for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Could not close visibility popup for',
                    selectedVideo,
                  ),
                );
                videoInviteeChanges.push(videoInviteeChange);
                continue;
              }

              const notifyCheckbox = nextDialog.querySelector<HTMLElement>(
                '#notify-via-email-checkbox #checkbox[aria-label="Notify via email"]',
              );

              if (!notifyCheckbox) {
                throw getStatusError(
                  `Could not find the Notify via email checkbox for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Could not find the Notify via email checkbox for',
                    selectedVideo,
                  ),
                );
              }

              if (notifyCheckbox.getAttribute('aria-checked') !== 'false') {
                throw new Error(
                  'YouTube Studio now appears to enable the "Notify via email" checkbox by default in the "Share video privately" dialog. The extension did not add or remove invitees. Please report this at https://github.com/upleveled/youtube-private-invitations/issues',
                );
              }

              const doneButton = nextDialog.querySelector<HTMLElement>(
                '#done-button button[aria-label="Done"]',
              );

              if (!doneButton) {
                throw getStatusError(
                  `Could not find the private-share Done button for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Could not find the private-share Done button for',
                    selectedVideo,
                  ),
                );
              }

              if (doneButton.getAttribute('aria-disabled') === 'true') {
                throw getStatusError(
                  `Private-share Done button is disabled for ${selectedVideo.videoId}`,
                  getVideoMessage(
                    'Private-share Done button is disabled for',
                    selectedVideo,
                  ),
                );
              }

              doneButton.click();

              await getElement(
                () =>
                  nextDialog.isConnected && isOpenPrivateShareDialog(nextDialog)
                    ? null
                    : nextDialog,
                `closed private-share dialog for ${selectedVideo.videoId}`,
                getVideoMessage(
                  'Could not close private-share dialog for',
                  selectedVideo,
                ),
                10000,
              );

              // Done only stages invitee changes - the visibility popup Save persists them
              const saveButton = await getElement(
                () => {
                  const element = visibilityPopup.querySelector<HTMLElement>(
                    'ytcp-button#save-button button',
                  );

                  return element &&
                    element.getAttribute('aria-disabled') !== 'true'
                    ? element
                    : null;
                },
                `enabled visibility popup Save button for ${selectedVideo.videoId}`,
                getVideoMessage(
                  'Could not find enabled visibility popup Save button for',
                  selectedVideo,
                ),
              );

              saveButton.click();

              await getElement(
                () =>
                  visibilityPopup.isConnected &&
                  isOpenVisibilityPopup(visibilityPopup)
                    ? null
                    : visibilityPopup,
                `closed visibility popup for ${selectedVideo.videoId}`,
                getVideoMessage(
                  'Could not close visibility popup for',
                  selectedVideo,
                ),
              );
              // The seed's success is verified against its captured response, not the DOM
              seededIndex = index;
              seededVideo = selectedVideo;
              seededVideoInviteeChange = videoInviteeChange;
              break;
            }

            if (seededVideo) {
              const seedStatus =
                await youtubeStudio.getMetadataUpdateStatus();

              if (!seedStatus.ok) {
                // The native Save was rejected server-side, so stop instead of replaying the same invalid data
                videoInviteeChanges.push({
                  video: seededVideo,
                  addedEmails: [],
                  removedEmails: [],
                  alreadyInvitedEmails: [],
                  notInvitedEmails: [],
                  error: `Update failed${
                    seedStatus.resultCode ? ` (${seedStatus.resultCode})` : ''
                  }`,
                });
              } else {
                if (!seededVideoInviteeChange) {
                  throw new Error('Could not find seeded video invitee change');
                }

                videoInviteeChanges.push(seededVideoInviteeChange);

                const remainingVideoIds = selectedVideos
                  .slice(seededIndex + 1)
                  .map((selectedVideo) => selectedVideo.videoId);

                if (remainingVideoIds.length > 0) {
                  showStatus(
                    `Applying ${remainingVideoIds.length} more videos`,
                    false,
                    0,
                  );

                  const results = await youtubeStudio.applyInvitees({
                    videoIds: remainingVideoIds,
                    addEmails: emailChanges.addEmails,
                    removeEmails: emailChanges.removeEmails,
                    onProgress(processedVideoCount) {
                      showStatus(
                        `Applying ${seededIndex + 1 + processedVideoCount}/${selectedVideos.length}`,
                        false,
                        0,
                      );
                    },
                  });

                  for (const result of results) {
                    const resultVideo = selectedVideos.find((selectedVideo) => {
                      return selectedVideo.videoId === result.videoId;
                    });

                    if (!resultVideo) {
                      throw new Error(
                        `Could not find selected video for ${result.videoId}`,
                      );
                    }

                    videoInviteeChanges.push({
                      video: resultVideo,
                      addedEmails: result.addedEmails,
                      removedEmails: result.removedEmails,
                      alreadyInvitedEmails: result.alreadyInvitedEmails,
                      notInvitedEmails: result.notInvitedEmails,
                      error: result.error,
                    });
                  }
                }
              }
            }

            const changedVideoCount = videoInviteeChanges.filter(
              (videoInviteeChange) => {
                return (
                  videoInviteeChange.addedEmails.length > 0 ||
                  videoInviteeChange.removedEmails.length > 0
                );
              },
            ).length;
            const failedVideoCount = videoInviteeChanges.filter(
              (videoInviteeChange) => {
                return videoInviteeChange.error !== undefined;
              },
            ).length;
            const statusMessage = getStatusMessage(
              failedVideoCount > 0
                ? changedVideoCount > 0
                  ? `Applied changes to ${changedVideoCount} videos, then stopped on a failure`
                  : 'Stopped on a failure'
                : changedVideoCount > 0
                  ? `Applied changes to ${changedVideoCount} videos`
                  : 'No changes needed',
            );

            statusMessage.append(getVideoInviteeChangeList(videoInviteeChanges));
            showStatus(statusMessage, true);
          } finally {
            button.disabled = false;
          }
        })().catch((error: unknown) => {
          console.error(error);
          const statusMessage = getStatusMessage(getErrorStatusMessage(error));

          if (videoInviteeChanges.length > 0) {
            statusMessage.append(
              getVideoInviteeChangeList(videoInviteeChanges),
            );
          }
          showStatus(statusMessage, true);
        });
      });
    }
});

const statusIconPaths: Record<'error' | 'neutral' | 'success', string> = {
  success: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  neutral:
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 2c1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12c0-4.42 3.58-8 8-8zm0 16c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z',
  error:
    'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
};

const statusIconLabels: Record<'error' | 'neutral' | 'success', string> = {
  success: 'Applied',
  neutral: 'Skipped',
  error: 'Error',
};

function getErrorStatusMessage(error: unknown) {
  if (error instanceof Error && 'statusMessage' in error) {
    const statusMessage = error.statusMessage;

    if (typeof statusMessage === 'string' || statusMessage instanceof Node) {
      return statusMessage;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

function getStatusError(message: string, statusMessage: string | Node) {
  const error = new Error(message) as Error & { statusMessage: string | Node };

  error.statusMessage = statusMessage;

  return error;
}

function getStatusMessage(message: string | Node) {
  const fragment = document.createDocumentFragment();
  const title = document.createElement('div');

  title.className = 'youtube-private-invitations-status-title';
  title.append(message);
  fragment.append(title);

  return fragment;
}

function getVideoLink(video: StudioVideo) {
  const link = document.createElement('a');

  link.className = 'youtube-private-invitations-video-link';
  link.href = video.url;
  link.rel = 'noopener noreferrer';
  link.target = '_blank';
  link.textContent = video.title;
  link.title = `${video.title} (${video.videoId})`;

  return link;
}

function getVideoList(videos: StudioVideo[]) {
  const list = document.createElement('ul');

  list.className = 'youtube-private-invitations-video-list';

  for (const video of videos) {
    const listItem = document.createElement('li');

    listItem.append(getVideoLink(video));
    list.append(listItem);
  }

  return getVideoListContainer(list, videos.length);
}

function getVideoInviteeChangeList(videoInviteeChanges: VideoInviteeChange[]) {
  const list = document.createElement('ul');

  list.className =
    'youtube-private-invitations-video-list youtube-private-invitations-video-change-list';

  for (const videoInviteeChange of videoInviteeChanges) {
    const listItem = document.createElement('li');

    listItem.append(getVideoLink(videoInviteeChange.video));
    appendVideoInviteeChangeDetail(
      listItem,
      'Added',
      videoInviteeChange.addedEmails,
      videoInviteeChange.alreadyInvitedEmails,
      'Already invited',
    );
    appendVideoInviteeChangeDetail(
      listItem,
      'Removed',
      videoInviteeChange.removedEmails,
      videoInviteeChange.notInvitedEmails,
      'Not invited',
    );

    if (videoInviteeChange.error) {
      const error = document.createElement('div');
      const label = document.createElement('span');
      const text = document.createElement('span');

      error.className =
        'youtube-private-invitations-video-change-detail youtube-private-invitations-video-change-detail-error';
      label.className = 'youtube-private-invitations-video-change-label';
      label.textContent = 'Error';
      text.textContent = videoInviteeChange.error;
      error.append(label, text);
      listItem.append(error);
    }

    list.append(listItem);
  }

  return getVideoListContainer(list, videoInviteeChanges.length);
}

function getVideoListContainer(list: HTMLUListElement, videoCount: number) {
  if (videoCount <= 5) {
    const container = document.createElement('div');

    container.className = 'youtube-private-invitations-video-list-container';
    container.append(list);
    setVideoListScrollState(container, list);

    return container;
  }

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const summaryText = document.createElement('span');

  details.className = 'youtube-private-invitations-video-details';
  summaryText.textContent = `${videoCount} selected videos`;
  summary.append(summaryText, getChevronIcon());
  details.append(summary, list);
  setVideoListScrollState(details, list);
  details.addEventListener('toggle', () => {
    setVideoListScrollState(details, list);
  });

  return details;
}

function appendVideoInviteeChangeDetail(
  listItem: HTMLLIElement,
  labelText: string,
  emails: string[],
  skippedEmails: string[],
  skippedStatusText: string,
) {
  if (emails.length === 0 && skippedEmails.length === 0) {
    return;
  }

  const detail = document.createElement('div');
  const label = document.createElement('span');

  detail.className = 'youtube-private-invitations-video-change-detail';
  label.className = 'youtube-private-invitations-video-change-label';
  label.textContent = labelText;
  detail.append(label);

  for (const email of emails) {
    const changed = document.createElement('span');

    changed.className = 'youtube-private-invitations-video-change-email';
    changed.append(
      getInlineStatusIcon('success', statusIconLabels.success, {
        tooltip: false,
      }),
      email,
    );
    detail.append(changed);
  }

  for (const skippedEmail of skippedEmails) {
    const skipped = document.createElement('span');

    skipped.className =
      'youtube-private-invitations-video-change-email youtube-private-invitations-video-change-skipped';
    addTooltip(skipped, skippedStatusText);
    skipped.append(
      getInlineStatusIcon('neutral', skippedStatusText, {
        tooltip: false,
      }),
      skippedEmail,
    );
    detail.append(skipped);
  }

  listItem.append(detail);
}

function setVideoListScrollState(container: HTMLElement, list: HTMLElement) {
  function updateScrollState() {
    container.dataset.scrollUp = list.scrollTop > 0 ? 'true' : 'false';
    container.dataset.scrollDown =
      list.scrollTop + list.clientHeight < list.scrollHeight - 1
        ? 'true'
        : 'false';
  }

  list.addEventListener('scroll', updateScrollState);
  window.requestAnimationFrame(updateScrollState);
}

function getChevronIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  svg.classList.add('youtube-private-invitations-chevron');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  path.setAttribute(
    'd',
    'M18.707 8.793a1 1 0 00-1.414 0L12 14.086 6.707 8.793a1 1 0 10-1.414 1.414L12 16.914l6.707-6.707a1 1 0 000-1.414Z',
  );
  svg.append(path);

  return svg;
}

function getVideoMessage(message: string, video: StudioVideo, detail = '') {
  const fragment = document.createDocumentFragment();

  fragment.append(`${message} `, getVideoLink(video));

  if (detail) {
    fragment.append(`: ${detail}`);
  }

  return fragment;
}

function appendStatusOutcome(
  list: HTMLUListElement,
  status: 'error' | 'neutral' | 'success',
  message: Node | string,
) {
  const listItem = document.createElement('li');

  const textElement = document.createElement('span');
  listItem.append(getInlineStatusIcon(status));
  textElement.append(message);
  listItem.append(textElement);

  list.append(listItem);
}

function getInlineStatusIcon(
  status: 'error' | 'neutral' | 'success',
  label = statusIconLabels[status],
  options = { tooltip: true },
) {
  const icon = document.createElement('span');
  icon.className = `youtube-private-invitations-status-icon youtube-private-invitations-status-icon-${status}`;

  if (options.tooltip) {
    icon.setAttribute('aria-label', label);
    icon.setAttribute('role', 'img');
    addTooltip(icon, label);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', statusIconPaths[status]);
  svg.append(path);
  icon.append(svg);

  return icon;
}

function addTooltip(anchor: HTMLElement, text: string) {
  anchor.addEventListener('mouseenter', () => {
    showTooltip(anchor, text);
  });
  anchor.addEventListener('focus', () => {
    showTooltip(anchor, text);
  });
  anchor.addEventListener('mouseleave', removeTooltip);
  anchor.addEventListener('blur', removeTooltip);
}

function showTooltip(anchor: HTMLElement, text: string) {
  removeTooltip();

  const tooltip = document.createElement('div');
  const anchorRect = anchor.getBoundingClientRect();

  tooltip.id = 'youtube-private-invitations-tooltip';
  tooltip.className = 'youtube-private-invitations-tooltip';
  tooltip.textContent = text;
  tooltip.style.left = `${anchorRect.left + anchorRect.width / 2}px`;
  tooltip.style.top = `${anchorRect.top - 8}px`;
  document.documentElement.append(tooltip);
}

function removeTooltip() {
  const tooltip = document.getElementById('youtube-private-invitations-tooltip');

  if (tooltip) {
    tooltip.remove();
  }
}

function showStatus(
  message: string | Node,
  sticky = false,
  timeoutMilliseconds = 6000,
) {
  const status = document.getElementById(statusId);

  if (status) {
    status.remove();
  }

  const newStatus = document.createElement('div');
  newStatus.id = statusId;
  document.documentElement.append(newStatus);

  const content = document.createElement('div');
  content.className = 'youtube-private-invitations-status-content';
  content.append(message);

  newStatus.append(content);

  // Final messages stay until the user reloads, since Studio's cached invitee state is now stale
  if (sticky) {
    const reloadButton = document.createElement('button');
    reloadButton.type = 'button';
    reloadButton.className = 'youtube-private-invitations-status-reload';
    reloadButton.textContent = 'Reload';
    reloadButton.addEventListener('click', () => {
      window.location.reload();
    });
    newStatus.append(reloadButton);
    return;
  }

  if (timeoutMilliseconds > 0) {
    window.setTimeout(() => {
      const currentStatus = document.getElementById(statusId);

      if (currentStatus && currentStatus.textContent === newStatus.textContent) {
        currentStatus.remove();
      }
    }, timeoutMilliseconds);
  }
}

async function getElement<ElementType extends Element>(
  findElement: () => ElementType | null | undefined,
  description: string,
  statusMessage?: string | Node,
  timeoutMilliseconds = 5000,
) {
  return await new Promise<ElementType>((resolve, reject) => {
    const existingElement = findElement();

    if (existingElement) {
      resolve(existingElement);
      return;
    }

    let timeout = 0;
    const observer = new MutationObserver(() => {
      const element = findElement();

      if (element) {
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve(element);
      }
    });

    timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(
        statusMessage
          ? getStatusError(`Could not find ${description}`, statusMessage)
          : new Error(`Could not find ${description}`),
      );
    }, timeoutMilliseconds);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
}
