/* eslint-disable no-restricted-syntax -- YouTube Studio utilities read and edit YouTube Studio DOM */

function readStudioVideoIdFromHref(href: string) {
  const match = href.match(/\/video\/(?<videoId>[^/?#]+)/u);

  if (!match || !match.groups || !match.groups.videoId) {
    throw new Error(`Could not read video ID from ${href}`);
  }

  return match.groups.videoId;
}

type StudioVideo = {
  row: Element;
  videoId: string;
};

export function getSelectedStudioVideos() {
  const selectedVideos: StudioVideo[] = [];

  for (const row of document.querySelectorAll('ytcp-video-row')) {
    if (!row.querySelector('[role="checkbox"][aria-checked="true"]')) {
      continue;
    }

    const link = row.querySelector<HTMLAnchorElement>('a[href*="/video/"]');

    if (!link) {
      throw new Error('Selected video row has no Studio video link');
    }

    selectedVideos.push({ row, videoId: readStudioVideoIdFromHref(link.href) });
  }

  if (selectedVideos.length === 0) {
    throw new Error('Select one or more videos in YouTube Studio first');
  }

  const selectionLabel = document.querySelector(
    'ytcp-bulk-actions .selection-label',
  );

  if (!selectionLabel) {
    throw new Error('Could not find the YouTube Studio selection count');
  }

  const match = selectionLabel.textContent.match(/(?<count>\d+) selected/u);

  if (!match || !match.groups || !match.groups.count) {
    throw new Error(
      `Could not read the selection count from "${selectionLabel.textContent}"`,
    );
  }

  if (Number(match.groups.count) !== selectedVideos.length) {
    throw new Error(
      `YouTube shows ${match.groups.count} selected videos, but ${selectedVideos.length} checked rows were found`,
    );
  }

  return selectedVideos;
}

export function assertStudioVideoRowStillMatchesVideo(
  row: Element,
  videoId: string,
) {
  if (!row.isConnected) {
    throw new Error(`Selected video row is no longer visible for ${videoId}`);
  }

  const link = row.querySelector<HTMLAnchorElement>('a[href*="/video/"]');

  if (!link) {
    throw new Error(`Selected video row lost its Studio video link for ${videoId}`);
  }

  const currentVideoId = readStudioVideoIdFromHref(link.href);

  if (currentVideoId !== videoId) {
    throw new Error(`Selected video row changed from ${videoId} to ${currentVideoId}`);
  }
}

export function isOpenPrivateShareDialog(element: HTMLElement) {
  const dialogElement = element.querySelector<HTMLElement>('[role="dialog"]');

  return (
    dialogElement !== null &&
    !dialogElement.hidden &&
    dialogElement.getAttribute('aria-hidden') !== 'true' &&
    getComputedStyle(dialogElement).display !== 'none'
  );
}

export function isOpenVisibilityPopup(element: HTMLElement) {
  const popupDialog = element.querySelector<HTMLElement>('tp-yt-paper-dialog');

  return (
    popupDialog !== null &&
    !popupDialog.hidden &&
    popupDialog.getAttribute('aria-hidden') !== 'true' &&
    getComputedStyle(popupDialog).display !== 'none'
  );
}

export function findInviteeChip(dialog: HTMLElement, email: string) {
  return Array.from(dialog.querySelectorAll<HTMLElement>('ytcp-chip[aria-label]')).find(
    (element) => {
      const inviteeEmail = element.getAttribute('aria-label');
      return (
        inviteeEmail !== null &&
        inviteeEmail.toLowerCase() === email.toLowerCase()
      );
    },
  );
}

type PrivateShareTarget = {
  shareGaiaTarget?: {
    emailAddress?: string;
    obfuscatedGaiaId?: string;
  };
  shareEmailTarget?: {
    emailAddress?: string;
  };
};

export function getPrivateShareTargetEmail(target: PrivateShareTarget) {
  const shareGaiaTarget = target.shareGaiaTarget;

  if (shareGaiaTarget && shareGaiaTarget.emailAddress) {
    return shareGaiaTarget.emailAddress;
  }

  const shareEmailTarget = target.shareEmailTarget;

  if (shareEmailTarget && shareEmailTarget.emailAddress) {
    return shareEmailTarget.emailAddress;
  }

  return null;
}

export function getPrivateShareTargetObfuscatedGaiaId(target: PrivateShareTarget) {
  const shareGaiaTarget = target.shareGaiaTarget;

  if (shareGaiaTarget && shareGaiaTarget.obfuscatedGaiaId) {
    return shareGaiaTarget.obfuscatedGaiaId;
  }

  return null;
}

const metadataUpdatePath = '/youtubei/v1/video_manager/metadata_update';
const getCreatorVideosPath = '/youtubei/v1/creator/get_creator_videos';
const listCreatorVideosPath = '/youtubei/v1/creator/list_creator_videos';

type StudioMetadataUpdateBody = {
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

type CapturedStudioRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: StudioMetadataUpdateBody;
};

type CapturedStudioMetadataUpdate = {
  request: CapturedStudioRequest;
  response: unknown;
};

type StudioMetadataUpdateResponse = {
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

function getHeadersObject(headers: Headers) {
  const result: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    result[key] = value;
  }

  return result;
}

function parseYoutubeiJson(text: string): unknown {
  // Some InnerTube responses are prefixed with )]}' to prevent JSON hijacking
  return JSON.parse(text.replace(/^\)\]\}'\n?/u, ''));
}

function assertNotifyViaEmailIsNotTrue(privateShare: {
  notifyViaEmail?: unknown;
} | undefined) {
  if (privateShare && privateShare.notifyViaEmail === true) {
    throw new Error('Refusing to send notifyViaEmail: true');
  }
}

function assertNotifyViaEmailUnset(privateShare: {
  notifyViaEmail?: unknown;
} | undefined) {
  if (privateShare && privateShare.notifyViaEmail !== undefined) {
    throw new Error('Refusing to replay notifyViaEmail');
  }
}

export function initYoutubeStudio() {
  const originalFetch = window.fetch;
  let lastMetadataUpdateCapture: CapturedStudioMetadataUpdate | null = null;
  let lastReadContext: {
    headers: Record<string, string>;
    context: unknown;
  } | null = null;

  function captureMetadataUpdate(
    request: CapturedStudioRequest,
    responseText: string,
  ) {
    const responseBody = parseYoutubeiJson(responseText);

    // Title and privacy edits hit the same endpoint, so only keep private-share captures
    if (request.body.privateShare) {
      assertNotifyViaEmailIsNotTrue(request.body.privateShare);
      lastMetadataUpdateCapture = { request, response: responseBody };
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

  XMLHttpRequest.prototype.open = function openXhrWithCapture(
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

  XMLHttpRequest.prototype.setRequestHeader = function setXhrRequestHeaderWithCapture(
    name: string,
    value: string,
  ) {
    const capture = xhrCaptures.get(this);

    if (capture) {
      capture.headers[name] = value;
    }

    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function sendXhrWithCapture(
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
              body: JSON.parse(capture.body) as StudioMetadataUpdateBody,
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
            headers: getHeadersObject(request.headers),
            body: JSON.parse(
              await request.clone().text(),
            ) as StudioMetadataUpdateBody,
          },
          await response.clone().text(),
        );
      } else if (
        url.includes(getCreatorVideosPath) ||
        url.includes(listCreatorVideosPath)
      ) {
        const request = new Request(input, init);
        captureReadContext(
          getHeadersObject(request.headers),
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

  type ReplayTarget = {
    videoId: string;
    shareEmails?: string;
    deletedOgids?: string;
    deletedEmails?: string;
  };

  async function replayMetadataUpdate(target: ReplayTarget) {
    if (!lastMetadataUpdateCapture) {
      throw new Error('No captured metadata_update request yet');
    }

    const body = structuredClone(lastMetadataUpdateCapture.request.body);

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
    const privacyState = body.privacyState;

    if (!privacyState || privacyState.newPrivacy !== 'PRIVATE') {
      throw new Error(
        `Captured metadata_update privacyState is not PRIVATE: ${JSON.stringify(privacyState)}`,
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

    assertNotifyViaEmailUnset(body.privateShare);

    const response = await originalFetch(lastMetadataUpdateCapture.request.url, {
      method: lastMetadataUpdateCapture.request.method,
      headers: lastMetadataUpdateCapture.request.headers,
      body: JSON.stringify(body),
      credentials: 'include',
    });

    return {
      status: response.status,
      body: (await response.json()) as StudioMetadataUpdateResponse,
    };
  }

  type StudioInvitee = {
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

  // Read current invitees for any video ids via get_creator_videos, which needs no botguard attestation
  async function readPrivateShareVideos(videoIds: string[]) {
    if (!lastReadContext) {
      throw new Error('No captured read context yet');
    }

    const response = await originalFetch(`${getCreatorVideosPath}?alt=json`, {
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
    });
    const parsed = (await response.json()) as GetCreatorVideosResponse;

    const map: Record<string, { privacy?: string; invitees: StudioInvitee[] }> = {};

    if (!parsed.videos) {
      throw new Error('get_creator_videos response has no videos');
    }

    for (const video of parsed.videos) {
      if (!video.videoId) {
        continue;
      }

      const privateShareTargets = video.privateShare
        ? video.privateShare.privateShareTargets
        : [];

      map[video.videoId] = {
        privacy: video.privacy,
        invitees: privateShareTargets
          ? privateShareTargets.map((target) => {
            return {
              email: getPrivateShareTargetEmail(target),
              ogid: getPrivateShareTargetObfuscatedGaiaId(target),
            };
          })
          : [],
      };
    }

    return map;
  }

  // The seed video's native Save closes its dialog optimistically, so wait for its metadata_update capture to land
  async function waitForMetadataUpdateCapture() {
    const deadline = Date.now() + 10000;

    while (!lastMetadataUpdateCapture) {
      if (Date.now() > deadline) {
        return false;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 100);
      });
    }

    return true;
  }

  async function getMetadataUpdateStatus() {
    let ok = false;
    let resultCode: string | undefined;

    if (await waitForMetadataUpdateCapture()) {
      if (!lastMetadataUpdateCapture) {
        throw new Error('No captured metadata_update response after wait');
      }

      const response =
        lastMetadataUpdateCapture.response as StudioMetadataUpdateResponse;
      const overallResult = response.overallResult;
      const privateShare = response.privateShare;

      resultCode = overallResult ? overallResult.resultCode : undefined;
      ok =
        resultCode === 'UPDATE_SUCCESS' &&
        privateShare !== undefined &&
        privateShare.success === true;
    }

    return { ok, resultCode };
  }

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
    try {
      const map = await readPrivateShareVideos(target.videoIds);

      if (!(await waitForMetadataUpdateCapture())) {
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
                300 + Math.floor(Math.random() * 1100),
              );
            });
          }

          const { body } = await replayMetadataUpdate({
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
            creatorEntities.wrappedVideoData.video.privateShare
              .privateShareTargets
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
    } finally {
      // Discard the captured write template so its attestation cannot be reused later
      lastMetadataUpdateCapture = null;
    }
  }

  return {
    applyInvitees,
    getMetadataUpdateStatus,
    resetLastMetadataUpdateCapture() {
      lastMetadataUpdateCapture = null;
    },
  };
}
