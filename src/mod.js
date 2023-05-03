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

	/**
	 * @param {AdBreakOptions} options
	 */
	async function showAdHelper(options) {
		/** @type {Promise<PlacementInfo>} */
		const promise = new Promise((resolve) => {
			adBreak({
				...options,
				beforeAd() {
					if (!initializeContext) throw new Error("Plugin is not initialized");
					initializeContext.setNeedsMute(true);
				},
				afterAd() {
					if (!initializeContext) throw new Error("Plugin is not initialized");
					initializeContext.setNeedsMute(false);
				},
				adBreakDone(placementInfo) {
					resolve(placementInfo);
				},
			});
		});
		const googleResult = await promise;

		let didShowAd = false;
		/** @type {import("$adlad").AdErrorReason?} */
		let errorReason = null;

		const status = googleResult.breakStatus;
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

	/** @type {import("$adlad").AdLadPlugin} */
	const plugin = {
		name: "google-ad-placement",
		async initialize(ctx) {
			if (initializeCalled) {
				throw new Error("Google Ad Placement plugin is being initialized more than once");
			}
			initializeCalled = true;
			initializeContext = ctx;

			const scriptTag = document.createElement("script");
			scriptTag.async = true;
			scriptTag.dataset.adClient = publisherId;
			if (adFrequencyHint) {
				scriptTag.dataset.adFrequencyHint = adFrequencyHint;
			}
			// scriptTag.dataset.adbreakTest = "on";
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
		},
		manualNeedsMute: true,
		async showFullScreenAd() {
			return await showAdHelper({
				type: "pause",
			});
		},
		async showRewardedAd() {
			return await showAdHelper({
				type: "reward",
				beforeReward(showAdFn) {
					showAdFn();
				},
				adDismissed() {},
				adViewed() {},
			});
		},
	};

	return plugin;
}
