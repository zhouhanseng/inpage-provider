
const through = require('through2')

/**
 * Returns a transform stream that applies some transform function to objects
 * passing through.
 * @param {function} transformFunction the function transforming the object
 * @return {stream.Transform}
 */
function createObjectTransformStream (transformFunction) {
  return through.obj(function (obj, _, cb) {
    this.push(transformFunction(obj))
    cb()
  })
}

function logStreamDisconnectWarning (remoteLabel, err) {
  let warningMsg = `MetamaskInpageProvider - lost connection to ${remoteLabel}`
  if (err) warningMsg += '\n' + err.stack
  console.warn(warningMsg)
  const listeners = this.listenerCount('error')
  if (listeners > 0) {
    this.emit('error', warningMsg)
  }
}

const promiseCallback = (resolve, reject) => (error, response) => {
  error || response.error
  ? reject(error || response.error)
  : resolve(response)
}

module.exports = {
  createObjectTransformStream,
  logStreamDisconnectWarning,
  promiseCallback,
}
