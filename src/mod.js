/**
 * @param {Object} options
 * @param {string} options.publisherId
 * @param {string | undefined} [options.adFrequencyHint]
 */
export function googleAdPlacementPlugin({
	publisherId,
	adFrequencyHint,
}) {
	let initializeCalled = false;
	window.adsbygoogle = window.adsbygoogle || [];

	/** @typedef {"preroll" | "start" | "pause" | "next" | "browse" | "reward"} AdBreakType */
	/** @typedef {"notReady" | "timeout" | "error" | "noAdPreloaded" | "frequencyCapped" | "ignored" | "other" | "dismissed" | "viewed"} AdBreakStatus */
	/**
	 * @typedef PlacementInfo
	 * @property {AdBreakType} breakType
	 * @property {string} breakName
	 * @property {"interstitial" | "reward"} breakFormat
	 * @property {AdBreakStatus} breakStatus
	 */
	/**
	 * @typedef AdBreakOptions
	 * @property {AdBreakType} type
	 * @property {string} [name]
	 * @property {() => void} [beforeAd]
	 * @property {() => void} [afterAd]
	 * @property {(showAdFn: (() => void)) => void} [beforeReward]
	 * @property {() => void} [adDismissed]
	 * @property {() => void} [adViewed]
	 * @property {(placementInfo: PlacementInfo) => void} [adBreakDone]
	 */

	/**
	 * @typedef AdConfigOptions
	 * @property {"on" | "auto"} [preloadAdBreaks]
	 * @property {"on" | "off"} [sound]
	 * @property {() => void} [onReady]
	 */

	/**
	 * @param {AdBreakOptions} options
	 */
	function adBreak(options) {
		window.adsbygoogle.push(options);
	}
	/**
	 * @param {AdConfigOptions} options
	 */
	function adConfig(options) {
		window.adsbygoogle.push(options);
	}

	/** @type {import("$adlad").AdLadPluginInitializeContext?} */
	let initializeContext = null;

	const beforeAfter = {
		beforeAd() {
			if (!initializeContext) throw new Error("Plugin is not initialized");
			initializeContext.setNeedsPause(true);
			initializeContext.setNeedsMute(true);
		},
		afterAd() {
			if (!initializeContext) throw new Error("Plugin is not initialized");
			initializeContext.setNeedsMute(false);
			initializeContext.setNeedsPause(false);
		},
	};

	/**
	 * @param {PlacementInfo} placementInfo
	 */
	function placementInfoToAdLadResult(placementInfo) {
		let didShowAd = false;
		/** @type {import("$adlad").AdErrorReason?} */
		let errorReason = null;

		const status = placementInfo.breakStatus;
		if (status == "viewed") {
			didShowAd = true;
		} else if (status == "frequencyCapped") {
			errorReason = "time-constraint";
		} else if (status == "dismissed") {
			errorReason = "user-dismissed";
		} else if (status == "notReady" || status == "timeout" || status == "noAdPreloaded") {
			errorReason = "no-ad-available";
		} else {
			errorReason = "unknown";
		}

		/** @type {import("$adlad").ShowFullScreenAdResult} */
		const result = {
			didShowAd,
			errorReason,
		};
		return result;
	}

	// AdSense and AdLad have two different apis for finding out if rewarded ads are available.
	// AdSense uses a callback inside a callback like so:
	//
	// ```js
	// adBreak({
	// 	...
	// 	beforeReward(showAdFn) {
	// 		// Call `showAdFn()` when a button is clicked
	// 	}
	// })
	// ```
	//
	// But adlad requires us to set `ctx.setCanShowRewardedAd()`.
	// To make this work, we call `adBreak()` in a loop until the user requests an ad.

	/** @type {(() => Promise<PlacementInfo>)?} */
	let showRewardedAdFn = null;
	/** @type {((placementInfo: PlacementInfo) => void)?} */
	let resolveRewardedAdFn = null;

	const REWARDED_LOOP_RETRY_TIMEOUT = 1000;

	async function rewardedLoop() {
		if (!initializeContext) throw new Error("Plugin is not initialized");
		const certainInitializeContext = initializeContext;
		let lastCallTime = 0;
		while (true) {
			/** @type {Promise<PlacementInfo>} */
			const promise = new Promise((resolve) => {
				lastCallTime = performance.now();
				adBreak({
					type: "reward",
					...beforeAfter,
					beforeReward(showAdFn) {
						showRewardedAdFn = () => {
							certainInitializeContext.setCanShowRewardedAd(false);
							showAdFn();
							/** @type {Promise<PlacementInfo>} */
							const promise = new Promise((resolve) => {
								resolveRewardedAdFn = resolve;
							});
							return promise;
						};
						certainInitializeContext.setCanShowRewardedAd(true);
					},
					adDismissed() {},
					adViewed() {},
					adBreakDone(placementInfo) {
						resolve(placementInfo);
					},
				});
			});
			const result = await promise;
			// It's possible for resolveRewardedAdFn to not exist yet.
			// For example, adBreakDone might fire without beforeReward has even f
			if (resolveRewardedAdFn) {
				resolveRewardedAdFn(result);
			}
			resolveRewardedAdFn = null;
			showRewardedAdFn = null;
			certainInitializeContext.setCanShowRewardedAd(false);
			const timePassed = performance.now() - lastCallTime;
			const timeLeft = REWARDED_LOOP_RETRY_TIMEOUT - timePassed;
			if (timeLeft > 0) {
				/** @type {Promise<void>} */
				const promise = new Promise((resolve) => {
					setTimeout(() => {
						resolve();
					}, timeLeft);
				});
				await promise;
			}
		}
	}

	const plugin = /** @type {const} @satisfies {import("$adlad").AdLadPlugin} */ ({
		name: "google-ad-placement",
		async initialize(ctx) {
			if (initializeCalled) {
				throw new Error("Google Ad Placement plugin is being initialized more than once");
			}
			initializeCalled = true;
			initializeContext = ctx;

			ctx.setCanShowRewardedAd(false);

			const scriptTag = document.createElement("script");
			scriptTag.async = true;
			scriptTag.dataset.adClient = publisherId;
			if (adFrequencyHint) {
				scriptTag.dataset.adFrequencyHint = adFrequencyHint;
			}
			if (ctx.useTestAds) {
				scriptTag.dataset.adbreakTest = "on";
			}
			scriptTag.crossOrigin = "anonymous";
			scriptTag.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + publisherId;

			/** @type {Promise<void>} */
			const promise = new Promise((resolve, reject) => {
				scriptTag.addEventListener("load", () => {
					resolve();
				});
				scriptTag.addEventListener("error", (error) => {
					reject(error);
				});
			});
			document.head.appendChild(scriptTag);
			await promise;

			adConfig({
				preloadAdBreaks: "on",
			});

			rewardedLoop();
		},
		manualNeedsMute: true,
		manualNeedsPause: true,
		async showFullScreenAd() {
			/** @type {Promise<PlacementInfo>} */
			const promise = new Promise((resolve) => {
				adBreak({
					type: "pause",
					...beforeAfter,
					adBreakDone(placementInfo) {
						resolve(placementInfo);
					},
				});
			});
			return placementInfoToAdLadResult(await promise);
		},
		async showRewardedAd() {
			if (!showRewardedAdFn) {
				return {
					didShowAd: false,
					errorReason: "no-ad-available",
				};
			}
			const result = await showRewardedAdFn();
			return placementInfoToAdLadResult(result);
		},
	});

	return plugin;
}
