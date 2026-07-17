/* eslint-disable no-restricted-syntax -- Content script automation reads and edits YouTube Studio DOM */

import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  assertStudioVideoRowStillMatchesVideo,
  findInviteeChip,
  getSelectedStudioVideos,
  isOpenPrivateShareDialog,
  isOpenVisibilityPopup,
} from '../util/youtubeStudio.js';

const buttonId = 'youtube-private-invitations-share-private';
const statusId = 'youtube-private-invitations-status';
const isolatedMessageSource = 'youtube-private-invitations-isolated';
const mainWorldMessageSource = 'youtube-private-invitations-main';

export default defineContentScript({
  matches: ['https://studio.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    document.documentElement.insertAdjacentHTML(
      'beforeend',
      `<style>
        #${buttonId} { appearance: none; background: none; border: 0; cursor: pointer; margin: 0; }
        #${buttonId}:disabled { cursor: wait; opacity: 0.6; }
        #${statusId} { align-items: start; background-color: var(--ytcp-text-primary, #0f0f0f); border-radius: var(--ytcp-m-border-radius, 2px); bottom: 24px; box-shadow: 0 2px 5px 0 rgba(0, 0, 0, .26); box-sizing: border-box; color: var(--ytcp-text-primary-inverse, #fff); display: grid; font: 400 14px/20px Roboto, Arial, sans-serif; gap: 12px; grid-template-columns: minmax(0, max-content) auto; left: 24px; max-width: calc(100vw - 48px); min-height: 48px; min-width: 288px; padding: 12px 16px; pointer-events: auto; position: fixed; width: fit-content; z-index: 20000; }
        #${statusId} .youtube-private-invitations-status-content { max-height: 240px; max-width: 560px; min-width: 0; overflow-y: auto; }
        #${statusId} .youtube-private-invitations-status-title { color: var(--ytcp-text-primary-inverse, #fff); font: 500 14px/20px Roboto, Arial, sans-serif; }
        #${statusId} .youtube-private-invitations-status-detail { align-items: baseline; color: var(--ytcp-text-primary-inverse, #fff); display: flex; font: 400 13px/18px Roboto, Arial, sans-serif; gap: 6px; margin-top: 2px; min-width: 0; }
        #${statusId} .youtube-private-invitations-status-detail-label { flex: 0 0 auto; font-weight: 500; }
        #${statusId} .youtube-private-invitations-status-detail-value { overflow-wrap: anywhere; }
        #${statusId} ul { list-style: none; margin: 8px 0 0; padding: 0; }
        #${statusId} li { align-items: flex-start; display: flex; font: 400 13px/18px Roboto, Arial, sans-serif; gap: 6px; }
        #${statusId} .youtube-private-invitations-status-icon { align-items: center; display: inline-flex; flex: 0 0 auto; height: 18px; }
        #${statusId} .youtube-private-invitations-status-icon-success { color: #81c995; }
        #${statusId} .youtube-private-invitations-status-icon-neutral { color: #9aa0a6; }
        #${statusId} .youtube-private-invitations-status-icon-error { color: #f28b82; }
        #${statusId} .youtube-private-invitations-status-reload { appearance: none; background: none; border: 0; border-radius: var(--ytcp-m-border-radius, 2px); color: #3ea6ff; cursor: pointer; font: 500 14px/20px Roboto, Arial, sans-serif; margin: -6px -8px 0 0; padding: 6px 8px; text-transform: uppercase; white-space: nowrap; }
        #${statusId} .youtube-private-invitations-status-reload:hover { background: rgba(62, 166, 255, .1); }
        .youtube-private-invitations-backdrop { background-color: var(--iron-overlay-backdrop-background-color, #000); inset: 0; opacity: var(--iron-overlay-backdrop-opacity, .6); position: fixed; z-index: 2203; }
        .youtube-private-invitations-dialog { background: var(--paper-dialog-background-color, var(--primary-background-color, #fff)); border-radius: var(--ytcp-dialog-border-radius, var(--ytcp-xxl-border-radius, 12px)); box-shadow: var(--ytcp-dialog-box-shadow, 0 16px 24px 2px rgba(0, 0, 0, .14), 0 6px 30px 5px rgba(0, 0, 0, .12), 0 8px 10px -5px rgba(0, 0, 0, .4)); box-sizing: border-box; color: var(--paper-dialog-color, var(--primary-text-color, #0f0f0f)); display: flex; flex-direction: column; font-family: Roboto, Noto, sans-serif; left: 50%; max-width: 576px; outline: none; position: fixed; top: 50%; transform: translate(-50%, -50%); width: 576px; z-index: 2204; }
        .youtube-private-invitations-dialog h1 { color: var(--ytcp-text-primary, #0f0f0f); display: flex; font: 700 20px/28px Roboto, Arial, sans-serif; margin: 12px 16px; padding: 7px 8px 5px; }
        .youtube-private-invitations-dialog .content { display: flex; flex-direction: column; gap: 12px; min-height: 48px; padding: 0 24px; }
        .youtube-private-invitations-targets { color: var(--ytcp-text-secondary, #606060); font: 400 14px/20px Roboto, Noto, sans-serif; margin: 0; }
        .youtube-private-invitations-field { display: flex; flex-direction: column; gap: 4px; margin: 0; }
        .youtube-private-invitations-field span { color: var(--ytcp-text-secondary, #606060); font: 500 12px/16px Roboto, Noto, sans-serif; }
        .youtube-private-invitations-dialog textarea { background: var(--paper-dialog-background-color, #fff); border: 1px solid var(--ytcp-line-divider, #d0d0d0); border-radius: var(--ytcp-m-border-radius, 2px); box-sizing: border-box; color: var(--ytcp-text-primary, #0f0f0f); font: 400 16px/24px Roboto, Noto, sans-serif; height: 88px; padding: 12px; resize: vertical; width: 528px; }
        .youtube-private-invitations-dialog textarea:focus,
        .youtube-private-invitations-dialog textarea:focus-visible { border-color: var(--paper-dialog-color, var(--primary-text-color, #f1f1f1)); box-shadow: none; outline: none; }
        .youtube-private-invitations-dialog .footer { display: flex; justify-content: flex-end; padding: 16px 24px 24px; }
        .youtube-private-invitations-dialog .footer > div { display: flex; gap: 8px; }
        .youtube-private-invitations-dialog button { border: 0; border-radius: 18px; box-sizing: border-box; cursor: pointer; font: 500 14px/20px Roboto, Arial, sans-serif; height: 36px; min-width: 36px; padding: 0 16px; }
        .youtube-private-invitations-dialog button[type='button'] { background: rgba(255, 255, 255, .1); color: var(--ytcp-text-primary, #0f0f0f); }
        .youtube-private-invitations-dialog button[type='submit'] { background: var(--ytcp-text-primary, #0f0f0f); color: var(--ytcp-text-primary-inverse, #fff); }
      </style>`,
    );

    function addSharePrivatelyAction() {
      if (document.getElementById(buttonId)) {
        return;
      }

      const toolbar = document.querySelector('ytcp-bulk-actions .toolbar');

      if (!toolbar) {
        return;
      }

      toolbar.insertAdjacentHTML(
        'beforeend',
        `<button id="${buttonId}" class="label style-scope ytcp-bulk-actions" type="button">Share privately</button>`,
      );

      const button = document.getElementById(buttonId);

      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Could not find "Share privately" button');
      }

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
            dialog.innerHTML = `<div class="header style-scope ytcp-dialog">
                <div class="header-content style-scope ytcp-dialog">
                  <h1 slot="primary-header" id="youtube-private-invitations-title" class="style-scope ytcp-private-video-sharing-dialog">Share privately</h1>
                </div>
              </div>
              <div class="content style-scope ytcp-dialog">
                <p class="description-text style-scope ytcp-private-video-sharing-dialog youtube-private-invitations-targets"></p>
                <label class="youtube-private-invitations-field">
                  <span>Add invitees</span>
                  <textarea name="addEmails" autofocus></textarea>
                </label>
                <label class="youtube-private-invitations-field">
                  <span>Remove invitees</span>
                  <textarea name="removeEmails"></textarea>
                </label>
              </div>
              <div class="footer style-scope ytcp-dialog">
                <div slot="secondary-footer" class="style-scope ytcp-private-video-sharing-dialog">
                  <button class="ytcpButtonShapeImplHost ytcpButtonShapeImpl--tonal ytcpButtonShapeImpl--mono ytcpButtonShapeImpl--size-m ytcpButtonShapeImpl--enable-backdrop-filter-experiment" type="button">Cancel</button>
                  <button class="ytcpButtonShapeImplHost ytcpButtonShapeImpl--filled ytcpButtonShapeImpl--mono ytcpButtonShapeImpl--size-m ytcpButtonShapeImpl--enable-backdrop-filter-experiment" type="submit">Apply</button>
                </div>
              </div>`;

            const targets = dialog.querySelector<HTMLElement>(
              '.youtube-private-invitations-targets',
            );

            if (!targets) {
              throw new Error('Could not find selected video summary');
            }

            targets.textContent = `${selectedVideos.length} selected: ${selectedVideos
              .map((selectedVideo) => {
                return selectedVideo.videoId;
              })
              .join(', ')}`;
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

              const addTextarea = dialog.querySelector<HTMLTextAreaElement>(
                'textarea[name="addEmails"]',
              );

              if (!addTextarea) {
                throw new Error('Could not find add invitees textarea');
              }

              const removeTextarea = dialog.querySelector<HTMLTextAreaElement>(
                'textarea[name="removeEmails"]',
              );

              if (!removeTextarea) {
                throw new Error('Could not find remove invitees textarea');
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
              const cancelButton = dialog.querySelector<HTMLButtonElement>(
                'button[type="button"]',
              );

              if (!cancelButton) {
                throw new Error(
                  'Could not find manual private-share cancel button',
                );
              }

              cancelButton.addEventListener('click', () => {
                resolve(null);
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
            await requestReset();

            // Drive the native dialog until one video actually changes, which seeds the API write template
            let seededIndex = -1;
            let seededVideo: (typeof selectedVideos)[number] | undefined;

            for (const [index, selectedVideo] of selectedVideos.entries()) {
              showStatus(`Applying ${index + 1}/${selectedVideos.length}`);

              if (index > 0) {
                await new Promise<void>((resolve) => {
                  window.setTimeout(
                    resolve,
                    1000 + Math.floor(Math.random() * 2000),
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
                const cancelButton = await getElement(
                  () =>
                    nextDialog.querySelector<HTMLElement>(
                      '#cancel-button button[aria-label="Cancel"]',
                    ),
                  `private-share Cancel button for ${selectedVideo.videoId}`,
                );

                cancelButton.click();

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
              const seedStatus = await requestSeedStatus();

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

                  const results = await requestApply({
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

    addSharePrivatelyAction();

    new MutationObserver(addSharePrivatelyAction).observe(document.body, {
      childList: true,
      subtree: true,
    });
  },
});

const statusIcons: Record<'error' | 'neutral' | 'success', string> = {
  success:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  neutral:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M19 13H5v-2h14z"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
};

function getStatusMessage(message: string) {
  const fragment = document.createDocumentFragment();
  const title = document.createElement('div');

  title.className = 'youtube-private-invitations-status-title';
  title.textContent = message;
  fragment.append(title);

  return fragment;
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
  icon.innerHTML = statusIcons[status];
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

  document.documentElement.insertAdjacentHTML(
    'beforeend',
    `<div id="${statusId}"></div>`,
  );

  const newStatus = document.getElementById(statusId);

  if (!newStatus) {
    throw new Error('Could not create status message');
  }

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

type ApplyResult = {
  videoId: string;
  added: string[];
  removed: string[];
  skipped: boolean;
  error?: string;
};

// Apply invitee changes to the remaining videos over the InnerTube API in the MAIN world content script
async function requestApply(target: {
  videoIds: string[];
  addEmails: string[];
  removeEmails: string[];
}) {
  return await new Promise<ApplyResult[]>((resolve, reject) => {
    const requestId = crypto.randomUUID();

    let timeout = 0;

    function handleMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as {
        source?: string;
        type?: string;
        requestId?: string;
        results?: ApplyResult[];
        message?: string;
      };

      if (
        data.source !== mainWorldMessageSource ||
        data.requestId !== requestId
      ) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);

      if (data.type === 'apply-result' && data.results) {
        resolve(data.results);
      } else {
        reject(new Error(data.message || 'Private-share API apply failed'));
      }
    }

    window.addEventListener('message', handleMessage);
    timeout = window.setTimeout(
      () => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Private-share API apply timed out'));
      },
      target.videoIds.length * 5000 + 30000,
    );
    window.postMessage(
      {
        source: isolatedMessageSource,
        type: 'apply',
        requestId,
        videoIds: target.videoIds,
        addEmails: target.addEmails,
        removeEmails: target.removeEmails,
      },
      window.location.origin,
    );
  });
}

// Ask the MAIN world content script whether the seed video's captured metadata_update succeeded server-side
async function requestSeedStatus() {
  return await new Promise<{ ok: boolean; resultCode?: string }>(
    (resolve, reject) => {
      const requestId = crypto.randomUUID();

      let timeout = 0;

      function handleMessage(event: MessageEvent) {
        if (
          event.source !== window ||
          event.origin !== window.location.origin
        ) {
          return;
        }

        const data = event.data as {
          source?: string;
          type?: string;
          requestId?: string;
          ok?: boolean;
          resultCode?: string;
          message?: string;
        };

        if (
          data.source !== mainWorldMessageSource ||
          data.requestId !== requestId
        ) {
          return;
        }

        window.clearTimeout(timeout);
        window.removeEventListener('message', handleMessage);

        if (data.type === 'seed-status-result') {
          resolve({ ok: data.ok === true, resultCode: data.resultCode });
        } else {
          reject(new Error(data.message || 'Private-share seed check failed'));
        }
      }

      window.addEventListener('message', handleMessage);
      timeout = window.setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Private-share seed check timed out'));
      }, 15000);
      window.postMessage(
        {
          source: isolatedMessageSource,
          type: 'seed-status',
          requestId,
        },
        window.location.origin,
      );
    },
  );
}

// Ask the MAIN world content script to drop any stale capture before the next seed
async function requestReset() {
  return await new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID();

    let timeout = 0;

    function handleMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as {
        source?: string;
        type?: string;
        requestId?: string;
      };

      if (
        data.source !== mainWorldMessageSource ||
        data.requestId !== requestId ||
        data.type !== 'reset-result'
      ) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      resolve();
    }

    window.addEventListener('message', handleMessage);
    timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      reject(new Error('Private-share reset timed out'));
    }, 15000);
    window.postMessage(
      {
        source: isolatedMessageSource,
        type: 'reset',
        requestId,
      },
      window.location.origin,
    );
  });
}
