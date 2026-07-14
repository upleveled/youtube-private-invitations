/* eslint-disable no-restricted-syntax -- Content script automation reads and edits YouTube Studio DOM */

import { defineContentScript } from 'wxt/utils/define-content-script';

const buttonId = 'youtube-private-invitations-share-private';
const statusId = 'youtube-private-invitations-status';
const rowSelector =
  'ytcp-video-row, ytcp-video-list-row, ytcp-video-list-cell-video, tr';

export default defineContentScript({
  matches: ['https://studio.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    document.documentElement.insertAdjacentHTML(
      'beforeend',
      `<style>
        #${buttonId} { background-color: var(--ytcp-text-primary, #0f0f0f); border: 0; border-radius: var(--ytcp-m-border-radius, 2px); color: var(--ytcp-text-primary-inverse, #fff); cursor: pointer; font: 500 13px/20px Roboto, Arial, sans-serif; height: 32px; margin-left: 8px; padding: 0 12px; }
        #${buttonId}:disabled { cursor: wait; opacity: 0.6; }
        #${statusId} { align-items: center; background-color: var(--ytcp-text-primary, #0f0f0f); border-radius: var(--ytcp-m-border-radius, 2px); bottom: 8px; box-shadow: 0 2px 5px 0 rgba(0, 0, 0, .26); box-sizing: border-box; color: var(--ytcp-text-primary-inverse, #fff); display: flex; font: 400 14px/20px Roboto, Arial, sans-serif; left: 8px; max-width: 288px; min-height: 48px; min-width: 288px; padding: 8px 12px; pointer-events: auto; position: fixed; z-index: 20000; }
        .youtube-private-invitations-backdrop { background-color: var(--iron-overlay-backdrop-background-color, #000); inset: 0; opacity: var(--iron-overlay-backdrop-opacity, .6); position: fixed; z-index: 2203; }
        .youtube-private-invitations-dialog { background: var(--paper-dialog-background-color, var(--primary-background-color, #fff)); border-radius: var(--ytcp-dialog-border-radius, var(--ytcp-xxl-border-radius, 12px)); box-shadow: var(--ytcp-dialog-box-shadow, 0 16px 24px 2px rgba(0, 0, 0, .14), 0 6px 30px 5px rgba(0, 0, 0, .12), 0 8px 10px -5px rgba(0, 0, 0, .4)); box-sizing: border-box; color: var(--paper-dialog-color, var(--primary-text-color, #0f0f0f)); display: flex; flex-direction: column; font: 400 14px/20px Roboto, Noto, sans-serif; left: 50%; max-width: 576px; min-height: 353px; outline: none; position: fixed; top: 32px; transform: translateX(-50%); width: calc(100vw - 80px); z-index: 2204; }
        .youtube-private-invitations-dialog header { padding: 24px 24px 0; }
        .youtube-private-invitations-dialog h1 { font: 500 20px/28px Roboto, Noto, sans-serif; margin: 0; }
        .youtube-private-invitations-dialog section { display: flex; flex-direction: column; gap: 16px; padding: 16px 24px; }
        .youtube-private-invitations-dialog label { color: var(--ytcp-text-primary, #0f0f0f); display: flex; flex-direction: column; font: 500 13px/20px Roboto, Noto, sans-serif; gap: 4px; }
        .youtube-private-invitations-dialog textarea { background: var(--paper-dialog-background-color, #fff); border: 1px solid var(--ytcp-line-divider, #d0d0d0); border-radius: var(--ytcp-m-border-radius, 2px); box-sizing: border-box; color: var(--ytcp-text-primary, #0f0f0f); font: 400 14px/20px Roboto, Noto, sans-serif; min-height: 88px; padding: 8px; resize: vertical; width: 100%; }
        .youtube-private-invitations-dialog footer { display: flex; gap: 8px; justify-content: flex-end; padding: 8px 24px 24px; }
        .youtube-private-invitations-dialog button { border: 0; border-radius: var(--ytcp-m-border-radius, 2px); cursor: pointer; font: 500 14px/20px Roboto, Noto, sans-serif; min-height: 36px; padding: 8px 16px; }
        .youtube-private-invitations-dialog button[type='button'] { background: transparent; color: var(--ytcp-text-secondary, #606060); }
        .youtube-private-invitations-dialog button[type='submit'] { background-color: var(--ytcp-text-primary, #0f0f0f); color: var(--ytcp-text-primary-inverse, #fff); }
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
        `<button id="${buttonId}" type="button">Share privately</button>`,
      );

      const button = document.getElementById(buttonId);

      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Could not find Share privately button');
      }

      button.addEventListener('click', () => {
        void (async () => {
          try {
            button.disabled = true;
            showStatus('Collecting selected videos');

            const videoIds = [
              ...new Set(
                Array.from(document.querySelectorAll(rowSelector))
                  .filter((row) => {
                    return (
                      row.querySelector('[checked], [aria-checked="true"]') !==
                        null || row.matches('[selected], [aria-selected="true"]')
                    );
                  })
                  .map((row) => {
                    const videoId = row.getAttribute('video-id');

                    if (videoId) {
                      return videoId;
                    }

                    const link =
                      row.querySelector<HTMLAnchorElement>('a[href*="/video/"]');

                    if (!link) {
                      throw new Error(
                        'Selected video row has no Studio video link',
                      );
                    }

                    const match = link.href.match(
                      /\/video\/(?<videoId>[^/?#]+)/u,
                    );

                    if (!match || !match.groups || !match.groups.videoId) {
                      throw new Error(`Could not read video ID from ${link.href}`);
                    }

                    return match.groups.videoId;
                  }),
              ),
            ];

            if (videoIds.length === 0 || !videoIds[0]) {
              throw new Error('Select one or more videos in YouTube Studio first');
            }

            document.documentElement.insertAdjacentHTML(
              'beforeend',
              `<div class="youtube-private-invitations-backdrop"></div>
              <form class="youtube-private-invitations-dialog" role="dialog" aria-modal="true" aria-labelledby="youtube-private-invitations-title">
                <header>
                  <h1 id="youtube-private-invitations-title">Share privately</h1>
                </header>
                <section>
                  <label>
                    Add invitees
                    <textarea name="addEmails" autofocus placeholder="person@example.com"></textarea>
                  </label>
                  <label>
                    Remove invitees
                    <textarea name="removeEmails" placeholder="person@example.com"></textarea>
                  </label>
                </section>
                <footer>
                  <button type="button">Cancel</button>
                  <button type="submit">Apply</button>
                </footer>
              </form>`,
            );

            const emailChanges = await new Promise<{
              addEmails: string[];
              removeEmails: string[];
            } | null>((resolve) => {
              const dialog = document.querySelector<HTMLFormElement>(
                '.youtube-private-invitations-dialog',
              );

              if (!dialog) {
                throw new Error('Could not find manual private-share dialog');
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

              const backdrop = document.querySelector<HTMLElement>(
                '.youtube-private-invitations-backdrop',
              );

              if (!backdrop) {
                throw new Error('Could not find manual private-share backdrop');
              }

              const dialogElement = dialog;
              const backdropElement = backdrop;

              function removeDialog() {
                backdropElement.remove();
                dialogElement.remove();
              }

              dialogElement.addEventListener('submit', (event) => {
                event.preventDefault();

                removeDialog();
                resolve({
                  addEmails: [
                    ...new Set(
                      addTextarea.value.match(
                        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
                      ) || [],
                    ),
                  ],
                  removeEmails: [
                    ...new Set(
                      removeTextarea.value.match(
                        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
                      ) || [],
                    ),
                  ],
                });
              });
              const cancelButton =
                dialogElement.querySelector<HTMLButtonElement>(
                  'button[type="button"]',
                );

              if (!cancelButton) {
                throw new Error('Could not find manual private-share cancel button');
              }

              cancelButton.addEventListener('click', () => {
                removeDialog();
                resolve(null);
              });
              addTextarea.focus();
            });

            if (!emailChanges) {
              return;
            }

            if (
              emailChanges.addEmails.length === 0 &&
              emailChanges.removeEmails.length === 0
            ) {
              throw new Error('Add at least one invitee email address');
            }

            for (const addEmail of emailChanges.addEmails) {
              if (
                emailChanges.removeEmails.some((removeEmail) => {
                  return removeEmail.toLowerCase() === addEmail.toLowerCase();
                })
              ) {
                throw new Error(`Do not add and remove ${addEmail}`);
              }
            }

            for (const [index, videoId] of videoIds.entries()) {
              showStatus(`Sharing ${index + 1} of ${videoIds.length}: ${videoId}`);

              if (index > 0) {
                await new Promise<void>((resolve) => {
                  window.setTimeout(
                    resolve,
                    1000 + Math.floor(Math.random() * 2000),
                  );
                });
              }

              const link = document.querySelector(
                `a[href*="/video/${CSS.escape(videoId)}"]`,
              );

              if (!link) {
                throw new Error(`Could not find video row link for ${videoId}`);
              }

              const row = link.closest(rowSelector);

              if (!row) {
                throw new Error(`Could not find video row for ${videoId}`);
              }

              const clickableSelector =
                'button, tp-yt-paper-button, ytcp-button, ytcp-dropdown-trigger, [role="button"]';
              const shareButton = Array.from(
                row.querySelectorAll<HTMLElement>(clickableSelector),
              ).find((element) => {
                return ['Share privately', 'Share video privately'].includes(
                  element.textContent.trim(),
                );
              });

              if (shareButton) {
                shareButton.click();
              } else {
                const visibilityControl = [
                  'ytcp-video-visibility-select',
                  '[aria-label*="Visibility"]',
                  '[test-id*="VISIBILITY"]',
                  '[id*="visibility" i]',
                ]
                  .map((selector) => {
                    return row.querySelector<HTMLElement>(selector);
                  })
                  .find((element) => {
                    return element !== null;
                  });

                if (!visibilityControl) {
                  throw new Error(`Could not find visibility control for ${videoId}`);
                }

                visibilityControl.click();

                const menuShareButton = await getElement(
                  () =>
                    Array.from(
                      document.querySelectorAll<HTMLElement>(clickableSelector),
                    ).find((element) => {
                      return ['Share privately', 'Share video privately'].includes(
                        element.textContent.trim(),
                      );
                    }),
                  `private-share menu item for ${videoId}`,
                );

                menuShareButton.click();
              }

              const nextDialog = await getElement(
                () =>
                  Array.from(
                    document.querySelectorAll<HTMLElement>(
                      'ytcp-dialog.ytcp-private-video-sharing-dialog, ytcp-dialog',
                    ),
                  ).find((element) => {
                    return element.textContent.includes('Share video privately');
                  }),
                'YouTube private-share dialog',
              );

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
                  inputValueDescriptor.set.call(input, addEmail);
                  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
                  input.dispatchEvent(
                    new KeyboardEvent('keydown', {
                      bubbles: true,
                      key: 'Enter',
                    }),
                  );
                  input.dispatchEvent(
                    new KeyboardEvent('keyup', {
                      bubbles: true,
                      key: 'Enter',
                    }),
                  );
                  await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 150);
                  });
                }
              }

              for (const removeEmail of emailChanges.removeEmails) {
                const chip = Array.from(
                  nextDialog.querySelectorAll<HTMLElement>('ytcp-chip[aria-label]'),
                ).find((element) => {
                  const email = element.getAttribute('aria-label');
                  return (
                    email !== null &&
                    email.toLowerCase() === removeEmail.toLowerCase()
                  );
                });

                if (chip) {
                  const deleteButton = chip.querySelector<HTMLElement>(
                    '#delete-icon, [aria-label="Remove"]',
                  );

                  if (!deleteButton) {
                    throw new Error(`Could not remove ${removeEmail}`);
                  }

                  deleteButton.click();
                  await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 150);
                  });
                }
              }

              const notifyCheckbox = nextDialog.querySelector<HTMLElement>(
                '#notify-via-email-checkbox #checkbox[aria-label="Notify via email"]',
              );

              if (!notifyCheckbox) {
                throw new Error('Could not find the Notify via email checkbox');
              }

              if (notifyCheckbox.getAttribute('aria-checked') === 'true') {
                notifyCheckbox.click();
              }

              const doneButton =
                nextDialog.querySelector<HTMLElement>(
                  '#done-button button[aria-label="Done"]',
                ) || nextDialog.querySelector<HTMLElement>('#done-button');

              if (!doneButton) {
                throw new Error('Could not find the private-share Done button');
              }

              doneButton.click();
            }

            showStatus(
              `Applied private-share changes to ${videoIds.length} videos`,
            );
          } finally {
            button.disabled = false;
          }
        })().catch((error: unknown) => {
          showStatus(error instanceof Error ? error.message : String(error));
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

async function getElement<ElementType extends Element>(
  findElement: () => ElementType | null | undefined,
  description: string,
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
    }, 5000);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

function showStatus(message: string) {
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

  newStatus.textContent = message;

  window.setTimeout(() => {
    const currentStatus = document.getElementById(statusId);

    if (currentStatus && currentStatus.textContent === message) {
      currentStatus.remove();
    }
  }, 6000);
}
