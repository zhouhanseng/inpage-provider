
const log = require('loglevel')
const { serializeError } = require('eth-json-rpc-errors')

/**
 * Middleware configuration object
 *
 * @typedef {Object} MiddlewareConfig
 */

/**
 * json-rpc-engine middleware that both logs standard and non-standard error
 * messages and ends middleware stack traversal if an error is encountered
 *
 * @returns {Function} json-rpc-engine middleware function
 */
function createErrorMiddleware () {
  return (req, res, next) => {
    next(done => {
      const { error } = res
      if (!error) {
        return done()
      // legacy eth_accounts behavior
      } else if (req.method === 'eth_accounts' && error.code === 4100) {
        log.warn(`MetaMask - Ignored RPC Error: ${error.message}`, error)
        delete res.error
        res.result = []
        return done()
      }
      serializeError(error)
      log.error(`MetaMask - RPC Error: ${error.message}`, error)
      done()
    })
  }
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
  : resolve(response.result)
}

module.exports = {
  createErrorMiddleware,
  logStreamDisconnectWarning,
  promiseCallback,
}
