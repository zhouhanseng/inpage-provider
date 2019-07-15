const pump = require('pump')
const RpcEngine = require('json-rpc-engine')
const createErrorMiddleware = require('./createErrorMiddleware')
const createIdRemapMiddleware = require('json-rpc-engine/src/idRemapMiddleware')
const createJsonRpcStream = require('json-rpc-middleware-stream')
const LocalStorageStore = require('obs-store')
const asStream = require('obs-store/lib/asStream')
const ObjectMultiplex = require('obj-multiplex')
const util = require('util')
const SafeEventEmitter = require('safe-event-emitter')

module.exports = MetamaskInpageProvider

util.inherits(MetamaskInpageProvider, SafeEventEmitter)

function MetamaskInpageProvider (connectionStream) {
  const self = this

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

  // TODO:synchronous
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
  self.send = self.send.bind(self)
  self.sendAsync = self.sendAsync.bind(self)

  // indicate that we've connected, for EIP-1193 compliance
  setTimeout(() => self.emit('connect'))
}

// EIP-1102 enable, deprecated, but here for backwards compatibility
MetamaskInpageProvider.prototype.enable = function () {
  const self = this

  const promiseCallback = (resolve, reject) => (error, response) => {
    if (error || response.error) {
      reject(error || response.error)
    } else {
      resolve(response.result)
    }
  }

  return new Promise((resolve, reject) => {
    self.sendAsync(
      {
        jsonrpc: '2.0',
        method: 'wallet_requestPermissions',
        params: [{ eth_requestAccounts: {} }],
      },
      promiseCallback(resolve, reject)
    )
  })
  .then(() => {
    return new Promise((resolve, reject) => {
      self.sendAsync(
        {
          method: 'eth_requestAccounts',
        },
        promiseCallback(resolve, reject)
      )
    })
  })
}

MetamaskInpageProvider.prototype.send = function (methodOrPayload, paramsOrCallback) {
  const self = this

  // Web3 1.0 backwards compatibility
  if (
    !Array.isArray(methodOrPayload) &&
    typeof methodOrPayload === 'object' &&
    typeof paramsOrCallback === 'function'
  ) {
    self.sendAsync(payload, callback)
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
    // throw not-supported error
    const link = 'https://eips.ethereum.org/EIPS/eip-1193'
    const message = `The MetaMask Web3 object does not support your given parameters. Please use ethereum.send(method: string, params: Array<any>). See ${link} for details.`
    throw new Error(message)
  }

  if (!Array.isArray(params)) params = undefined

  return new Promise((resolve, reject) => {
    try {
      self.sendAsync(
        { id: 1, jsonrpc: '2.0', method, params },
        (error, response) => {
          error || response.error
          ? reject(error)
          : resolve(response)
        }
      )
    } catch (error) {
      reject(error)
    }
  })
}

// handle sendAsync requests via asyncProvider
// also remap ids inbound and outbound
MetamaskInpageProvider.prototype.sendAsync = function (payload, cb) {
  const self = this

  if (payload.method === 'eth_signTypedData') {
    console.warn('MetaMask: This experimental version of eth_signTypedData will be deprecated in the next release in favor of the standard as defined in EIP-712. See https://git.io/fNzPl for more information on the new standard.')
  }

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

// util

function logStreamDisconnectWarning (remoteLabel, err) {
  let warningMsg = `MetamaskInpageProvider - lost connection to ${remoteLabel}`
  if (err) warningMsg += '\n' + err.stack
  console.warn(warningMsg)
  const listeners = this.listenerCount('error')
  if (listeners > 0) {
    this.emit('error', warningMsg)
  }
}
