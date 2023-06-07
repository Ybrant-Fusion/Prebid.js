import { getBidIdParameter, _each, isArray, getWindowTop, getUniqueIdentifierStr, deepSetValue, logError, logWarn, createTrackPixelHtml, getWindowSelf, isFn, isPlainObject } from '../src/utils.js';
import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER } from '../src/mediaTypes.js';
import { config } from '../src/config.js';
import { bidderSettings } from '../src/bidderSettings.js';

const BIDDER_CODE = 'brightcom';
const URL = 'https://brightcombid.marphezis.com/hb';

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER],
  gvlid: 883,
  isBidRequestValid,
  buildRequests,
  interpretResponse,
  getUserSyncs
};

function buildRequests(bidReqs, bidderRequest) {
  try {
    let referrer = '';
    if (bidderRequest && bidderRequest.refererInfo) {
      referrer = bidderRequest.refererInfo.page;
    }
    const brightcomImps = [];
    const publisherId = getBidIdParameter('publisherId', bidReqs[0].params);
    _each(bidReqs, function (bid) {
      let bidSizes = (bid.mediaTypes && bid.mediaTypes.banner && bid.mediaTypes.banner.sizes) || bid.sizes;
      bidSizes = ((isArray(bidSizes) && isArray(bidSizes[0])) ? bidSizes : [bidSizes]);
      bidSizes = bidSizes.filter(size => isArray(size));
      const processedSizes = bidSizes.map(size => ({w: parseInt(size[0], 10), h: parseInt(size[1], 10)}));

      const element = document.getElementById(bid.adUnitCode);
      const minSize = _getMinSize(processedSizes);
      const viewabilityAmount = _isViewabilityMeasurable(element)
        ? _getViewability(element, getWindowTop(), minSize)
        : 'na';
      const viewabilityAmountRounded = isNaN(viewabilityAmount) ? viewabilityAmount : Math.round(viewabilityAmount);

      const imp = {
        id: bid.bidId,
        banner: {
          format: processedSizes,
          ext: {
            viewability: viewabilityAmountRounded
          }
        },
        tagid: String(bid.adUnitCode)
      };
      const bidFloor = _getBidFloor(bid);
      if (bidFloor) {
        imp.bidfloor = bidFloor;
      }
      brightcomImps.push(imp);
    });
    const brightcomBidReq = {
      id: getUniqueIdentifierStr(),
      imp: brightcomImps,
      site: {
        domain: bidderRequest?.refererInfo?.domain || '',
        page: referrer,
        publisher: {
          id: publisherId
        }
      },
      device: {
        devicetype: _getDeviceType(),
        w: screen.width,
        h: screen.height
      },
      tmax: bidderRequest?.timeout
    };

    if (bidderRequest && bidderRequest.gdprConsent) {
      deepSetValue(brightcomBidReq, 'regs.ext.gdpr', +bidderRequest.gdprConsent.gdprApplies);
      deepSetValue(brightcomBidReq, 'user.ext.consent', bidderRequest.gdprConsent.consentString);
    }

    if (bidderRequest && bidderRequest.uspConsent) {
      deepSetValue(brightcomBidReq, 'regs.ext.us_privacy', bidderRequest.uspConsent);
    }

    if (config.getConfig('coppa') === true) {
      deepSetValue(brightcomBidReq, 'regs.coppa', 1);
    }

    if (bidReqs[0] && bidReqs[0].schain) {
      deepSetValue(brightcomBidReq, 'source.ext.schain', bidReqs[0].schain)
    }

    if (bidReqs[0] && bidReqs[0].userIdAsEids) {
      deepSetValue(brightcomBidReq, 'user.ext.eids', bidReqs[0].userIdAsEids || [])
    }

    if (bidReqs[0] && bidReqs[0].userId) {
      deepSetValue(brightcomBidReq, 'user.ext.ids', bidReqs[0].userId || [])
    }

    if (bidderSettings.get(BIDDER_CODE, 'storageAllowed')) {
      deepSetValue(brightcomBidReq, 'user.ext.iiq', JSON.stringify(_getFirstPartyData()));
    }

    return {
      method: 'POST',
      url: URL,
      data: JSON.stringify(brightcomBidReq),
    };
  } catch (e) {
    logError(e, {bidReqs, bidderRequest});
  }
}

function isBidRequestValid(bid) {
  if (bid.bidder !== BIDDER_CODE || typeof bid.params === 'undefined') {
    return false;
  }

  if (typeof bid.params.publisherId === 'undefined') {
    return false;
  }

  return true;
}

function interpretResponse(serverResponse) {
  if (!serverResponse.body || typeof serverResponse.body != 'object') {
    logWarn('Brightcom server returned empty/non-json response: ' + JSON.stringify(serverResponse.body));
    return [];
  }
  const {body: {id, seatbid}} = serverResponse;
  try {
    const brightcomBidResponses = [];
    if (id &&
      seatbid &&
      seatbid.length > 0 &&
      seatbid[0].bid &&
      seatbid[0].bid.length > 0) {
      seatbid[0].bid.map(brightcomBid => {
        brightcomBidResponses.push({
          requestId: brightcomBid.impid,
          cpm: parseFloat(brightcomBid.price),
          width: parseInt(brightcomBid.w),
          height: parseInt(brightcomBid.h),
          creativeId: brightcomBid.crid || brightcomBid.id,
          currency: 'USD',
          netRevenue: true,
          mediaType: BANNER,
          ad: _getAdMarkup(brightcomBid),
          ttl: 60,
          meta: {
            advertiserDomains: brightcomBid && brightcomBid.adomain ? brightcomBid.adomain : []
          }
        });
      });
    }
    return brightcomBidResponses;
  } catch (e) {
    logError(e, {id, seatbid});
  }
}

// Don't do user sync for now
function getUserSyncs(syncOptions, responses, gdprConsent) {
  return [];
}

function _isMobile() {
  return (/(ios|ipod|ipad|iphone|android)/i).test(navigator.userAgent);
}

function _isConnectedTV() {
  return (/(smart[-]?tv|hbbtv|appletv|googletv|hdmi|netcast\.tv|viera|nettv|roku|\bdtv\b|sonydtv|inettvbrowser|\btv\b)/i).test(navigator.userAgent);
}

function _getDeviceType() {
  return _isMobile() ? 1 : _isConnectedTV() ? 3 : 2;
}

function _getAdMarkup(bid) {
  let adm = bid.adm;
  if ('nurl' in bid) {
    adm += createTrackPixelHtml(bid.nurl);
  }
  return adm;
}

function _isViewabilityMeasurable(element) {
  return !_isIframe() && element !== null;
}

function _getViewability(element, topWin, {w, h} = {}) {
  return getWindowTop().document.visibilityState === 'visible'
    ? _getPercentInView(element, topWin, {w, h})
    : 0;
}

function _isIframe() {
  try {
    return getWindowSelf() !== getWindowTop();
  } catch (e) {
    return true;
  }
}

function _getMinSize(sizes) {
  return sizes.reduce((min, size) => size.h * size.w < min.h * min.w ? size : min);
}

function _getBoundingBox(element, {w, h} = {}) {
  let {width, height, left, top, right, bottom} = element.getBoundingClientRect();

  if ((width === 0 || height === 0) && w && h) {
    width = w;
    height = h;
    right = left + w;
    bottom = top + h;
  }

  return {width, height, left, top, right, bottom};
}

function _getIntersectionOfRects(rects) {
  const bbox = {
    left: rects[0].left,
    right: rects[0].right,
    top: rects[0].top,
    bottom: rects[0].bottom
  };

  for (let i = 1; i < rects.length; ++i) {
    bbox.left = Math.max(bbox.left, rects[i].left);
    bbox.right = Math.min(bbox.right, rects[i].right);

    if (bbox.left >= bbox.right) {
      return null;
    }

    bbox.top = Math.max(bbox.top, rects[i].top);
    bbox.bottom = Math.min(bbox.bottom, rects[i].bottom);

    if (bbox.top >= bbox.bottom) {
      return null;
    }
  }

  bbox.width = bbox.right - bbox.left;
  bbox.height = bbox.bottom - bbox.top;

  return bbox;
}

function _getPercentInView(element, topWin, {w, h} = {}) {
  const elementBoundingBox = _getBoundingBox(element, {w, h});

  // Obtain the intersection of the element and the viewport
  const elementInViewBoundingBox = _getIntersectionOfRects([{
    left: 0,
    top: 0,
    right: topWin.innerWidth,
    bottom: topWin.innerHeight
  }, elementBoundingBox]);

  let elementInViewArea, elementTotalArea;

  if (elementInViewBoundingBox !== null) {
    // Some or all of the element is in view
    elementInViewArea = elementInViewBoundingBox.width * elementInViewBoundingBox.height;
    elementTotalArea = elementBoundingBox.width * elementBoundingBox.height;

    return ((elementInViewArea / elementTotalArea) * 100);
  }

  // No overlap between element and the viewport; therefore, the element
  // lies completely out of view
  return 0;
}

function _getBidFloor(bid) {
  if (!isFn(bid.getFloor)) {
    return bid.params.bidFloor ? bid.params.bidFloor : null;
  }

  let floor = bid.getFloor({
    currency: 'USD',
    mediaType: '*',
    size: '*'
  });
  if (isPlainObject(floor) && !isNaN(floor.floor) && floor.currency === 'USD') {
    return floor.floor;
  }
  return null;
}

function _getFirstPartyData() {
  const generateGUID = function () {
    let d = new Date().getTime()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (d + Math.random() * 16) % 16 | 0
      d = Math.floor(d / 16)
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  };

  const tryParse = function (data) {
    try {
      return JSON.parse(data)
    } catch (err) {
      return null;
    }
  };
  const readData = function (key) {
    try {
      if (hasLocalStorage()) {
        return window.localStorage.getItem(key)
      }
    } catch (error) {
      return null;
    }
    return null
  };

  const storeData = function (key, value) {
    try {
      if (isDefined(value)) {
        if (hasLocalStorage()) {
          window.localStorage.setItem(key, value)
        }
      }
    } catch (error) {
      return null;
    }
  };
  const hasLocalStorage = function () {
    try {
      return !!window.localStorage
    } catch (e) {
      return null;
    }
  }
  const isDefined = function (val) {
    return typeof val !== 'undefined' && val != null
  };

  const loadOrCreateFirstPartyData = function () {
    var FIRST_PARTY_KEY = '_iiq_fdata';
    var firstPartyData = tryParse(readData(FIRST_PARTY_KEY))
    if (!firstPartyData || !firstPartyData.pcid) {
      var firstPartyId = generateGUID()
      firstPartyData = {pcid: firstPartyId, pcidDate: Date.now()}
      storeData(FIRST_PARTY_KEY, JSON.stringify(firstPartyData))
    } else if (firstPartyData && !firstPartyData.pcidDate) {
      firstPartyData.pcidDate = Date.now()
      storeData(FIRST_PARTY_KEY, JSON.stringify(firstPartyData))
    }

    return firstPartyData
  };

  return loadOrCreateFirstPartyData();
}

registerBidder(spec);
