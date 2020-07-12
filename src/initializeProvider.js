const PostMessageDuplexStream = require('post-message-stream')
const MetamaskInpageProvider = require('./MetamaskInpageProvider')

module.exports = {
  initializeProvider,
  setGlobalProvider,
}

const getDefaultConnectionStream = () => {
  return new PostMessageDuplexStream({
    name: 'inpage',
    target: 'contentscript',
  })
}

/**
   * Initializes a MetamaskInpageProvider and (optionally) sets it on window.ethereum.
   *
   * @param {Object} [options] - An options bag.
   * @param {Object} [options.connectionStream] - A Node.js stream. Will be assigned a MetaMask
   * default if not provided.
   * @param {number} [options.maxEventListeners=100] - The maximum number of event listeners.
   * @param {boolean} [options.protectProperties=true] - Whether to wrap the provider
   * in a proxy that prevents property deletion and some property overwrites.
   * @param {boolean} [options.shouldSendMetadata=true] - Whether the provider should send page metadata.
   * @param {boolean} [options.shouldSetOnWindow=true] - Whether the provider should be set as window.ethereum
   * @returns {MetamaskInpageProvider|Proxy} The initialized provider (whether set on window or not).
   */
function initializeProvider ({
  connectionStream,
  maxEventListeners = 100,
  shouldSendMetadata = true,
  shouldSetOnWindow = true,
} = {}) {

  const _connectionStream = connectionStream || getDefaultConnectionStream()

  let provider = new MetamaskInpageProvider(
    _connectionStream, { shouldSendMetadata, maxEventListeners },
  )

  provider = new Proxy(provider, {
    // prevent e.g. web3@1.x from deleting our stuff
    deleteProperty: () => true,
  })

  if (shouldSetOnWindow) {
    setGlobalProvider(provider)
  }

  return provider
}

/**
 * Sets the given provider instance as window.ethereum and dispatches the
 * 'ethereum#initialized' event on window.
 *
 * @param {MetamaskInpageProvider} providerInstance - The provider instance.
 */
function setGlobalProvider (providerInstance) {
  window.ethereum = providerInstance
  window.dispatchEvent(new Event('ethereum#initialized'))
}
