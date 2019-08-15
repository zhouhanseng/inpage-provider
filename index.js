
const pump = require('pump')
const RpcEngine = require('json-rpc-engine')
const createIdRemapMiddleware = require('json-rpc-engine/src/idRemapMiddleware')
const createJsonRpcStream = require('json-rpc-middleware-stream')
const LocalStorageStore = require('obs-store')
const asStream = require('obs-store/lib/asStream')
const ObjectMultiplex = require('obj-multiplex')
const { inherits } = require('util')
const SafeEventEmitter = require('safe-event-emitter')
const uuid = require('uuid/v4')

const { sendSiteMetadata } = require('./siteMetadata')
const {
  createErrorMiddleware,
  logStreamDisconnectWarning,
  promiseCallback,
} = require('./utils')
const messages = require('./messages.json')

module.exports = MetamaskInpageProvider

inherits(MetamaskInpageProvider, SafeEventEmitter)

function MetamaskInpageProvider (connectionStream) {
  const self = this

  self.state = {
    sentWarnings: {
      enable: false,
      sendAsync: false,
      signTypedData: false,
    },
    sentSiteMetadata: false,
  }

  // TODO:1193
  // self._isConnected = undefined

  // TODO:synchronous
  // self.selectedAddress = undefined
  // self.networkVersion = undefined

  // super constructor
  SafeEventEmitter.call(self)

  // setup connectionStream multiplexing
  const mux = self.mux = new ObjectMultiplex()
  pump(
    connectionStream,
    mux,
    connectionStream,
    logStreamDisconnectWarning.bind(this, 'MetaMask')
  )

  // subscribe to metamask public config (one-way)
  self.publicConfigStore = new LocalStorageStore({ storageKey: 'MetaMask-Config' })

  // TODO:1193
  // // Emit events for some state changes
  // self.publicConfigStore.subscribe(function (state) {

  //   Emit accountsChanged event on account change
  //   if ('selectedAddress' in state && state.selectedAddress !== self.selectedAddress) {
  //     self.selectedAddress = state.selectedAddress
  //     self.emit('accountsChanged', [self.selectedAddress])
  //   }

  //   Emit networkChanged event on network change
  //   if ('networkVersion' in state && state.networkVersion !== self.networkVersion) {
  //     self.networkVersion = state.networkVersion
  //     self.emit('networkChanged', state.networkVersion)
  //   }
  // })

  pump(
    mux.createStream('publicConfig'),
    asStream(self.publicConfigStore),
    logStreamDisconnectWarning.bind(this, 'MetaMask PublicConfigStore')
  )

  // ignore phishing warning message (handled elsewhere)
  mux.ignoreStream('phishing')

  // connect to async provider
  const jsonRpcConnection = createJsonRpcStream()
  pump(
    jsonRpcConnection.stream,
    mux.createStream('provider'),
    jsonRpcConnection.stream,
    logStreamDisconnectWarning.bind(this, 'MetaMask RpcProvider')
  )

  // handle sendAsync requests via dapp-side rpc engine
  const rpcEngine = new RpcEngine()
  rpcEngine.push(createIdRemapMiddleware())
  rpcEngine.push(createErrorMiddleware())
  rpcEngine.push(jsonRpcConnection.middleware)
  self.rpcEngine = rpcEngine

  // forward json rpc notifications
  jsonRpcConnection.events.on('notification', function(payload) {
    self.emit('data', null, payload)
  })

  // EIP-1193 subscriptions
  self.on('data', (error, { method, params }) => {
    if (!error && method === 'eth_subscription') {
      self.emit('notification', params.result)
    }
  })

  // Work around for https://github.com/metamask/metamask-extension/issues/5459
  // drizzle accidently breaking the `this` reference
  self.enable = self.enable.bind(self)
  self.send = self.send.bind(self)
  self.sendAsync = self.sendAsync.bind(self)
  self._sendAsync = self._sendAsync.bind(self)
  self._requestAccounts = self._requestAccounts.bind(self)

  // indicate that we've connected, for EIP-1193 compliance
  setTimeout(() => self.emit('connect'))
}

/**
 * Backwards compatibility method, to be deprecated.
 */
MetamaskInpageProvider.prototype.enable = function () {
  const self = this
  if (!self.state.sentWarnings.enable) {
    console.warn(messages.warnings.enableDeprecation)
    self.state.sentWarnings.enable = true
  }
  return self._requestAccounts()
}

/**
 * EIP-1102 eth_requestAccounts
 * Implemented here to remain EIP-1102-compliant with ocap permissions.
 * Attempts to call eth_accounts before requesting the permission.
 */
MetamaskInpageProvider.prototype._requestAccounts = function () {
  const self = this

  return new Promise((resolve, reject) => {
    self._sendAsync(
      {
        method: 'eth_accounts',
      },
      promiseCallback(resolve, reject)
    )
  })
  .catch(error => {
    if (error.code === 1) { // if it's an rpc-cap auth error
      return new Promise((resolve, reject) => {
        self._sendAsync(
          {
            jsonrpc: '2.0',
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
          },
          promiseCallback(resolve, reject)
        )
      })
      .then(() => {
        return new Promise((resolve, reject) => {
          self._sendAsync(
            {
              method: 'eth_accounts',
            },
            promiseCallback(resolve, reject)
          )
        })
      })
    } else {
      throw error
    }
  })
}

/**
 * EIP-1193 send, with backwards compatibility.
 */
MetamaskInpageProvider.prototype.send = function (methodOrPayload, paramsOrCallback) {
  const self = this

  // Web3 1.0 backwards compatibility
  if (
    !Array.isArray(methodOrPayload) &&
    typeof methodOrPayload === 'object' &&
    typeof paramsOrCallback === 'function'
  ) {
    self._sendAsync(payload, callback)
    return
  }

  // Per our docs as of <= 5/31/2019, send accepts a payload and returns
  // a promise, however per EIP-1193, send should accept a method string
  // and params array. Here we support both.
  let method, params
  if (
    typeof methodOrPayload === 'object' &&
    typeof methodOrPayload.method === 'string'
  ) {
    method = methodOrPayload.method
    params = methodOrPayload.params
  } else if (typeof methodOrPayload === 'string') {
    method = methodOrPayload
    params = paramsOrCallback
  } else {
    // throw invalid params error
    throw new Error(messages.errors.invalidParams)
  }

  if (!Array.isArray(params)) {
    if (params) params = [params]
    else params = []
  }

  if (method === 'eth_requestAccounts') return self._requestAccounts()

  return new Promise((resolve, reject) => {
    try {
      self._sendAsync(
        { jsonrpc: '2.0', method, params },
        promiseCallback(resolve, reject)
      )
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Web3 1.0 backwards compatibility method.
 */
MetamaskInpageProvider.prototype.sendAsync = function (payload, cb) {
  const self = this
  if (!self.state.sentWarnings.sendAsync) {
    console.warn(messages.warnings.sendAsyncDeprecation)
    self.state.sentWarnings.sendAsync = true
  }
  self._sendAsync(payload, cb)
}

/**
 * Internal RPC method. Forwards requests to background via the RPC engine.
 * Also remap ids inbound and outbound.
 */
MetamaskInpageProvider.prototype._sendAsync = function (payload, cb) {
  const self = this

  if (!self.state.sentSiteMetadata) {
    sendSiteMetadata(self.rpcEngine)
    self.state.sentSiteMetadata = true
  }

  if (
    payload.method === 'eth_signTypedData' &&
    !self.state.sentWarnings.signTypedData
  ) {
    console.warn(messages.warnings.signTypedDataDeprecation)
    self.state.sentWarnings.signTypedData = true
  }

  if (!payload.id) payload.id = uuid()

  self.rpcEngine.handle(payload, cb)
}

MetamaskInpageProvider.prototype.isConnected = function () {
  return true
}

MetamaskInpageProvider.prototype.isMetaMask = true

// TODO:1193
// MetamaskInpageProvider.prototype._onClose = function () {
//   if (this._isConnected === undefined || this._isConnected) {
//     this._provider.emit('close', {
//       code: 1011,
//       reason: 'Network connection error',
//     })
//   }
//   this._isConnected = false
// }
