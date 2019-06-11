const Events = require("events");
const ByteBuffer = require("bytebuffer");
const Protos = require("./Protos.js");

module.exports = class GameCoordinator extends Events {
	constructor(steamUser) {
		super();

		this.steamUser = steamUser;
		this.Protos = Protos([
			{
				name: "csgo",
				protos: [
					__dirname + "/../protobufs/csgo/gcsystemmsgs.proto",
					__dirname + "/../protobufs/csgo/gcsdk_gcmessages.proto",
					__dirname + "/../protobufs/csgo/cstrike15_gcmessages.proto"
				]
			}
		]);
		this._GCHelloInterval = null;
		this.startPromise = null;
		this.startTimeout = null;

		steamUser.on("receivedFromGC", (appid, msgType, payload) => {
			if (appid === 730) {
				if (msgType === this.Protos.csgo.EGCBaseClientMsg.k_EMsgGCClientWelcome) {
					if (this._GCHelloInterval !== null) {
						clearInterval(this._GCHelloInterval);
						this._GCHelloInterval = null;
					}

					if (this.startPromise !== null) {
						let msg = this.Protos.csgo.CMsgClientWelcome.decode(payload);
						this.startPromise(msg);
						this.startPromise = null;
					}

					if (this.startTimeout !== null) {
						clearTimeout(this.startTimeout);
						this.startTimeout = null;
					}
				}

				this.emit("message", msgType, payload);
			}

			this.emit("allMsg", appid, msgType, payload);
		});
	}

	start(timeout = 20000) {
		return new Promise((resolve, reject) => {
			this.startTimeout = setTimeout(() => {
				if (this._GCHelloInterval !== null) {
					clearInterval(this._GCHelloInterval);
					this._GCHelloInterval = null;
				}

				if (this.startPromise !== null) {
					this.startPromise = null;
				}

				reject(new Error("GC connection timeout"));
			}, timeout);

			this._GCHelloInterval = setInterval(() => {
				this.steamUser.sendToGC(730, this.Protos.csgo.EGCBaseClientMsg.k_EMsgGCClientHello, {} , new this.Protos.csgo.CMsgClientHello({}).toBuffer());
			}, 5000);

			this.startPromise = resolve;
		});
	}

	/**
	 * Send a message and get the response from it if needed
	 * @param {Number|undefined} appid AppID where to send the GC message to - Pass "undefined" for customized proto
	 * @param {Number} header The identifier of the message we are sending
	 * @param {Object} proto Header proto
	 * @param {Constructor|undefined} protobuf Constructor to create the buffer with settings. If "undefined" then "settings" HAS to be a buffer
	 * @param {Object} settings Settings to combine with the protobuf to construct the buffer
	 * @param {Number|undefined} responseHeader The response header to our request
	 * @param {Object|undefined} responseProtobuf Will automatically append ".decode()": Function which will be used to decode the protobuf. If "undefined" will not decode response and resolve with the raw buffer of the response
	 * @param {Number} timeout Max number of milliseconds before we give up on waiting for our response
	 * @returns {Promise} Promise which resolves in the object of our response, or undefined if "responseHeader" is undefined or rejects in a timeout error
	 */
	sendMessage(appid, header, proto, protobuf, settings, responseHeader, responseProtobuf, timeout = 30000) {
		return new Promise((resolve, reject) => {
			if (typeof appid === "undefined") {
				this.steamUser._send({
					msg: header,
					proto: proto
				}, typeof protobuf === "undefined" ? settings : new protobuf(settings).toBuffer());

				if (typeof responseHeader === "undefined") {
					resolve();
					return;
				}

				this.steamUser._handlerManager.add(responseHeader, (body) => {
					if (this.steamUser._handlerManager.hasHandler(responseHeader)) {
						if (this.steamUser._handlerManager._handlers[responseHeader] && this.steamUser._handlerManager._handlers[responseHeader].length > 0) {
							this.steamUser._handlerManager._handlers[responseHeader].pop(); // We added our message last (I assume) so remove the last one

							if (this.steamUser._handlerManager._handlers[responseHeader].length <= 0) {
								delete this.steamUser._handlerManager._handlers[responseHeader];
							}
						}
					}

					if (typeof responseProtobuf === "undefined") {
						if (body instanceof Buffer || body instanceof ByteBuffer) {
							resolve(body);
							return;
						}

						resolve(new responseProtobuf(body).toBuffer());
						return;
					}

					if (body instanceof Buffer || body instanceof ByteBuffer) {
						body = responseProtobuf.decode(body);
					}

					resolve(body);
				});
				return;
			}

			this.steamUser.sendToGC(appid, header, proto, typeof protobuf === "undefined" ? settings : new protobuf(settings).toBuffer());

			if (typeof responseHeader === "undefined") {
				resolve();
				return;
			}

			let sendTimeout = setTimeout(() => {
				this.removeListener("allMsg", sendMessageResponse);
				reject(new Error("Failed to send message: Timeout"));
			}, timeout);

			this.on("allMsg", sendMessageResponse);
			function sendMessageResponse(appid, msgType, payload) {
				if (msgType === responseHeader) {
					clearTimeout(sendTimeout);
					this.removeListener("allMsg", sendMessageResponse);

					if (typeof responseProtobuf === "undefined") {
						resolve(payload);
						return;
					}

					let msg = responseProtobuf.decode(payload);
					resolve(msg);
				}
			}
		});
	}
}
