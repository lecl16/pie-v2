if (!Array.prototype.toReversed) {
	Object.defineProperty(Array.prototype, 'toReversed', {
		value: function toReversed() {
			return this.slice().reverse();
		},
		writable: true,
		configurable: true,
	});
}

if (!Array.prototype.toSorted) {
	Object.defineProperty(Array.prototype, 'toSorted', {
		value: function toSorted(compareFn) {
			return this.slice().sort(compareFn);
		},
		writable: true,
		configurable: true,
	});
}

if (!Array.prototype.toSpliced) {
	Object.defineProperty(Array.prototype, 'toSpliced', {
		value: function toSpliced(start, deleteCount, ...items) {
			const copy = this.slice();
			copy.splice(start, deleteCount, ...items);
			return copy;
		},
		writable: true,
		configurable: true,
	});
}

const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
