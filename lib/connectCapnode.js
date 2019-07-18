import Capnode, { streamFromRemote } from 'capnode';
const pump = require('pump')

const capnode = new Capnode({})
const remote = capnode.createRemote();
const capStream = streamFromRemote(remote);

module.exports = function setupCapnode (externalStream) {

		let backgroundCapStream = extensionMux.createStream('cap')

    pump(
      capStream,
      externalStream,
      capStream,
      (err) => {
        // report any error
        if (err) console.error(err)
      }
    )

    return capnode
}

