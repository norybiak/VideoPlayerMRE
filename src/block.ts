export const block = (predicate: () => boolean, giveUp = 5000) => new Promise((resolve, reject) => {
	const timestamp = Date.now();
	setInterval(() => {
		if (predicate()) {
			return resolve();
		} else if (Date.now() - timestamp >= giveUp) {
			return reject(new Error("Took too long and now giving up"))
		}
	}, 1)
});

export default block;
