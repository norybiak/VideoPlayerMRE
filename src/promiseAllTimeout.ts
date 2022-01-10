export function promiseAllTimeout(promises: Promise<any>[], timeout: number, resolvePartial=true) {
    return new Promise(function(resolve, reject) {
        let results: Array<any> = [],
            finished = 0,
            numPromises = promises.length;
        let onFinish = function() {
            if (finished < numPromises) {
                if (resolvePartial) {
                    (resolve)(results);
                } else {
                    throw new Error("Not all promises completed within the specified time");
                }
            } else {
                (resolve)(results);
            }
            onFinish = null;
        };
        for (let i = 0; i < numPromises; i += 1) {
            results[i] = undefined;
            promises[i].then(
                function(res) {
                    results[i] = res;
                    finished += 1;
                    if (finished === numPromises && onFinish) {
                        onFinish();
                    }
                },
                reject
            );
        }
        setTimeout(function() {
            if (onFinish) {
                onFinish();
            }
        }, timeout);
    });
}