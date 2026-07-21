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

        const appliedVideoIds: string[] = [];
        const skippedInviteeChanges: string[] = [];
        const failedInviteeChanges: string[] = [];

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

            // Drive the native dialog until one video actually changes, which seeds the API write template
            let seededIndex = -1;
            let seededVideo: (typeof selectedVideos)[number] | undefined;

            for (const [index, selectedVideo] of selectedVideos.entries()) {
              showStatus(`Applying ${index + 1}/${selectedVideos.length}`);

              if (index > 0) {
                await new Promise<void>((resolve) => {
                  window.setTimeout(
                    resolve,
                    300 + Math.floor(Math.random() * 1100),
                  );
                });
              }

              assertStudioVideoRowStillMatchesVideo(
                selectedVideo.row,
                selectedVideo.videoId,
              );

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

              const visibilityControl =
                selectedVideo.row.querySelector<HTMLElement>(
                  '.tablecell-visibility .edit-triangle-icon',
                );

              if (!visibilityControl) {
                throw new Error(
                  `Could not find visibility control for ${selectedVideo.videoId}`,
                );
              }

              visibilityControl.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true }),
              );
              visibilityControl.dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true }),
              );
              visibilityControl.dispatchEvent(
                new PointerEvent('pointerup', { bubbles: true }),
              );
              visibilityControl.dispatchEvent(
                new MouseEvent('mouseup', { bubbles: true }),
              );
              visibilityControl.click();

              const visibilityPopup = await getElement(
                () =>
                  Array.from(
                    document.querySelectorAll<HTMLElement>(
                      'ytcp-video-visibility-edit-popup',
                    ),
                  ).find(isOpenVisibilityPopup),
                `visibility popup for ${selectedVideo.videoId}`,
              );

              const menuShareButton = await getElement(
                () =>
                  visibilityPopup.querySelector<HTMLElement>(
                    'ytcp-button.private-share-edit-button button',
                  ),
                `private-share button for ${selectedVideo.videoId}`,
              );

              menuShareButton.click();

              const nextDialog = await getElement(
                () =>
                  Array.from(
                    document.querySelectorAll<HTMLElement>(
                      'ytcp-dialog.ytcp-private-video-sharing-dialog',
                    ),
                  ).find(isOpenPrivateShareDialog),
                'YouTube private-share dialog',
              );

              let videoChanged = false;

              if (emailChanges.addEmails.length > 0) {
                const input = await getElement(
                  () =>
                    nextDialog.querySelector<HTMLInputElement>(
                      '#text-input[aria-label="Invitees"]',
                    ),
                  'private-share email input',
                );
                const inputValueDescriptor = Object.getOwnPropertyDescriptor(
                  Object.getPrototypeOf(input),
                  'value',
                );

                if (!inputValueDescriptor || !inputValueDescriptor.set) {
                  throw new Error(
                    'Could not set the private-share email input value',
                  );
                }

                for (const addEmail of emailChanges.addEmails) {
                  if (findInviteeChip(nextDialog, addEmail)) {
                    skippedInviteeChanges.push(
                      `${addEmail} already invited for ${selectedVideo.videoId}`,
                    );
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
                    `private-share chip for ${addEmail}`,
                  );
                  videoChanged = true;
                }
              }

              for (const removeEmail of emailChanges.removeEmails) {
                const chip = findInviteeChip(nextDialog, removeEmail);

                if (!chip) {
                  skippedInviteeChanges.push(
                    `${removeEmail} was not invited for ${selectedVideo.videoId}`,
                  );
                  continue;
                }

                const deleteButton =
                  chip.querySelector<HTMLElement>('#delete-icon');

                if (!deleteButton) {
                  throw new Error(`Could not remove ${removeEmail}`);
                }

                deleteButton.click();

                // dom-repeat reuses chip elements, so check aria-labels instead of the clicked chip
                await getElement(
                  () =>
                    findInviteeChip(nextDialog, removeEmail)
                      ? null
                      : nextDialog,
                  `removed chip for ${removeEmail}`,
                );
                videoChanged = true;
              }

              if (!videoChanged) {
                const shareCancelButton = await getElement(
                  () =>
                    nextDialog.querySelector<HTMLElement>(
                      '#cancel-button button[aria-label="Cancel"]',
                    ),
                  `private-share Cancel button for ${selectedVideo.videoId}`,
                );

                shareCancelButton.click();

                await getElement(
                  () =>
                    nextDialog.isConnected &&
                    isOpenPrivateShareDialog(nextDialog)
                      ? null
                      : nextDialog,
                  `closed private-share dialog for ${selectedVideo.videoId}`,
                  10000,
                );

                const popupCancelButton = await getElement(
                  () =>
                    visibilityPopup.querySelector<HTMLElement>(
                      'ytcp-button#cancel-button button[aria-label="Cancel"]',
                    ),
                  `visibility popup Cancel button for ${selectedVideo.videoId}`,
                );

                popupCancelButton.click();

                await getElement(
                  () =>
                    visibilityPopup.isConnected &&
                    isOpenVisibilityPopup(visibilityPopup)
                      ? null
                      : visibilityPopup,
                  `closed visibility popup for ${selectedVideo.videoId}`,
                );
                continue;
              }

              const notifyCheckbox = nextDialog.querySelector<HTMLElement>(
                '#notify-via-email-checkbox #checkbox[aria-label="Notify via email"]',
              );

              if (!notifyCheckbox) {
                throw new Error('Could not find the Notify via email checkbox');
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
                throw new Error('Could not find the private-share Done button');
              }

              if (doneButton.getAttribute('aria-disabled') === 'true') {
                throw new Error(
                  `Private-share Done button is disabled for ${selectedVideo.videoId}`,
                );
              }

              doneButton.click();

              await getElement(
                () =>
                  nextDialog.isConnected && isOpenPrivateShareDialog(nextDialog)
                    ? null
                    : nextDialog,
                `closed private-share dialog for ${selectedVideo.videoId}`,
                10000,
              );

              // Done only stages invitee changes - the visibility popup Save persists them
              const saveButton = await getElement(() => {
                const element = visibilityPopup.querySelector<HTMLElement>(
                  'ytcp-button#save-button button',
                );

                return element &&
                  element.getAttribute('aria-disabled') !== 'true'
                  ? element
                  : null;
              }, `enabled visibility popup Save button for ${selectedVideo.videoId}`);

              saveButton.click();

              await getElement(
                () =>
                  visibilityPopup.isConnected &&
                  isOpenVisibilityPopup(visibilityPopup)
                    ? null
                    : visibilityPopup,
                `closed visibility popup for ${selectedVideo.videoId}`,
              );
              // The seed's success is verified against its captured response, not the DOM
              seededIndex = index;
              seededVideo = selectedVideo;
              break;
            }

            if (seededVideo) {
              const seedVideoId = seededVideo.videoId;
              const seedStatus =
                await youtubeStudio.getMetadataUpdateStatus();

              if (!seedStatus.ok) {
                // The native Save was rejected server-side, so stop instead of replaying the same invalid data
                failedInviteeChanges.push(
                  `Update failed for ${seedVideoId}${
                    seedStatus.resultCode ? ` (${seedStatus.resultCode})` : ''
                  }`,
                );
              } else {
                appliedVideoIds.push(seedVideoId);

                const remainingVideoIds = selectedVideos
                  .slice(seededIndex + 1)
                  .map((selectedVideo) => selectedVideo.videoId);

                if (remainingVideoIds.length > 0) {
                  showStatus(
                    `Applying ${remainingVideoIds.length} more videos`,
                  );

                  const results = await youtubeStudio.applyInvitees({
                    videoIds: remainingVideoIds,
                    addEmails: emailChanges.addEmails,
                    removeEmails: emailChanges.removeEmails,
                  });

                  for (const result of results) {
                    if (result.error) {
                      failedInviteeChanges.push(result.error);
                    } else if (result.skipped) {
                      skippedInviteeChanges.push(
                        `No change needed for ${result.videoId}`,
                      );
                    } else {
                      appliedVideoIds.push(result.videoId);
                    }
                  }
                }
              }
            }

            const statusMessage = getStatusMessage(
              failedInviteeChanges.length > 0
                ? appliedVideoIds.length > 0
                  ? `Applied ${appliedVideoIds.length}, then stopped on a failure`
                  : 'Stopped on a failure'
                : appliedVideoIds.length > 0
                  ? `Applied changes to ${appliedVideoIds.length} videos`
                  : 'No changes needed',
            );

            if (emailChanges.addEmails.length > 0) {
              appendStatusDetail(
                statusMessage,
                'Add',
                emailChanges.addEmails.join(', '),
              );
            }

            if (emailChanges.removeEmails.length > 0) {
              appendStatusDetail(
                statusMessage,
                'Remove',
                emailChanges.removeEmails.join(', '),
              );
            }

            const statusList = document.createElement('ul');

            for (const videoId of appliedVideoIds) {
              appendStatusOutcome(statusList, 'success', `Applied ${videoId}`);
            }

            for (const failedInviteeChange of failedInviteeChanges) {
              appendStatusOutcome(statusList, 'error', failedInviteeChange);
            }

            for (const skippedInviteeChange of skippedInviteeChanges) {
              appendStatusOutcome(statusList, 'neutral', skippedInviteeChange);
            }

            if (statusList.children.length > 0) {
              statusMessage.append(statusList);
            }
            showStatus(statusMessage, true);
          } finally {
            button.disabled = false;
          }
        })().catch((error: unknown) => {
          console.error(error);
          const statusMessage = getStatusMessage(
            error instanceof Error ? error.message : String(error),
          );
          const statusList = document.createElement('ul');

          for (const videoId of appliedVideoIds) {
            appendStatusOutcome(statusList, 'success', `Applied ${videoId}`);
          }

          if (statusList.children.length > 0) {
            statusMessage.append(statusList);
          }
          showStatus(statusMessage, true);
        });
      });
    }
});

const statusIconPaths: Record<'error' | 'neutral' | 'success', string> = {
  success: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  neutral: 'M19 13H5v-2h14z',
  error:
    'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
};

function getStatusMessage(message: string) {
  const fragment = document.createDocumentFragment();
  const title = document.createElement('div');

  title.className = 'youtube-private-invitations-status-title';
  title.textContent = message;
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

function appendStatusDetail(parent: DocumentFragment, label: string, value: string) {
  const detail = document.createElement('div');
  const labelElement = document.createElement('span');
  const valueElement = document.createElement('span');

  detail.className = 'youtube-private-invitations-status-detail';
  labelElement.className = 'youtube-private-invitations-status-detail-label';
  labelElement.textContent = label;
  valueElement.className = 'youtube-private-invitations-status-detail-value';
  valueElement.textContent = value;
  detail.append(labelElement, valueElement);
  parent.append(detail);
}

function appendStatusOutcome(
  list: HTMLUListElement,
  status: 'error' | 'neutral' | 'success',
  text: string,
) {
  const listItem = document.createElement('li');

  const icon = document.createElement('span');
  icon.className = `youtube-private-invitations-status-icon youtube-private-invitations-status-icon-${status}`;

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
  listItem.append(icon);

  const textElement = document.createElement('span');
  textElement.textContent = text;
  listItem.append(textElement);

  list.append(listItem);
}

function showStatus(message: string | Node, sticky = false) {
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

  window.setTimeout(() => {
    const currentStatus = document.getElementById(statusId);

    if (currentStatus && currentStatus.textContent === newStatus.textContent) {
      currentStatus.remove();
    }
  }, 6000);
}

async function getElement<ElementType extends Element>(
  findElement: () => ElementType | null | undefined,
  description: string,
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
      reject(new Error(`Could not find ${description}`));
    }, timeoutMilliseconds);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
}
