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
        #${buttonId} { background: #0f0f0f; border: 0; border-radius: 2px; color: #fff; cursor: pointer; font: 500 13px/20px Roboto, Arial, sans-serif; height: 32px; margin-left: 8px; padding: 0 12px; }
        #${buttonId}:disabled { cursor: wait; opacity: 0.6; }
        #${statusId} { background: #0f0f0f; border-radius: 2px; bottom: 24px; color: #fff; font: 400 13px/20px Roboto, Arial, sans-serif; left: 24px; max-width: 420px; padding: 12px 16px; position: fixed; z-index: 2147483647; }
      </style>`,
    );

    function addShareButton() {
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

            await openPrivateShareDialog(videoIds[0]);

            const firstDialog = await getElement(
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

            const dialog = firstDialog;
            const invitees = await new Promise<string[]>((resolve, reject) => {
              const timeout = window.setTimeout(() => {
                dialog.removeEventListener('click', readInvitees, true);
                reject(
                  new Error('Timed out waiting for the private-share Done button'),
                );
              }, 30000);

              function readInvitees(event: MouseEvent) {
                if (
                  event.target instanceof Element &&
                  event.target.closest('#done-button, button[aria-label="Done"]')
                ) {
                  window.clearTimeout(timeout);
                  dialog.removeEventListener('click', readInvitees, true);
                  resolve([
                    ...new Set(
                      dialog.textContent.match(
                        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
                      ) || [],
                    ),
                  ]);
                }
              }

              dialog.addEventListener('click', readInvitees, true);
            });

            if (invitees.length === 0) {
              throw new Error('Add at least one invitee email address');
            }

            for (const [index, videoId] of videoIds.slice(1).entries()) {
              showStatus(`Sharing ${index + 2} of ${videoIds.length}: ${videoId}`);

              await new Promise<void>((resolve) => {
                window.setTimeout(
                  resolve,
                  1000 + Math.floor(Math.random() * 2000),
                );
              });

              await openPrivateShareDialog(videoId);

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

              for (const invitee of invitees) {
                inputValueDescriptor.set.call(input, invitee);
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
              `Shared ${invitees.length} invitees with ${videoIds.length} videos`,
            );
          } finally {
            button.disabled = false;
          }
        })().catch((error: unknown) => {
          showStatus(error instanceof Error ? error.message : String(error));
        });
      });
    }

    addShareButton();

    new MutationObserver(addShareButton).observe(document.body, {
      childList: true,
      subtree: true,
    });
  },
});

async function openPrivateShareDialog(videoId: string) {
  const link = document.querySelector(`a[href*="/video/${CSS.escape(videoId)}"]`);

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
    return;
  }

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
      Array.from(document.querySelectorAll<HTMLElement>(clickableSelector)).find(
        (element) => {
          return ['Share privately', 'Share video privately'].includes(
            element.textContent.trim(),
          );
        },
      ),
    `private-share menu item for ${videoId}`,
  );

  menuShareButton.click();
}

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
