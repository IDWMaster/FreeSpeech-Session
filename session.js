var dgram = require('dgram');


/**
 * @class
 */
var Session = function () {
    var sessionID;
    if(Session.available.length>0) {
        sessionID = Session.available.pop();
    }else {
        sessionID = Session.CID;
        Session.CID++;
    }
    
    var callbacks = new Array();
    
    
    
    var reassemblyBuffer = new Object();
    
    var currentPacketID = 0;
    
    var Protected = {};
    var retval = {
        send: function (data) {},
        /**
         * Registers a callback which is invoked when a packet is received
         */
        registerReceiveCallback: function (callback) {
            return callbacks.push(callback) - 1;
        },
        /**
         * Unregisters a callback
         */
        unregisterReceiveCallback: function (id) {
            callbacks.splice(id, 1);
        },
        /**
         * Subclasses this instance
         */
        subclass: function (callback) {
            callback(Protected);
            return this;
        },
                close: function () {
                    Session.available.push(sessionID);
                },
                /**
                 * Encodes and transmits a packet, fragmenting it if necessary
                 * @param {Buffer} data
                 * @returns {undefined}
                 */
                sendPacket:function(data) {
                    //TODO: Encode in general packet format
                    var packetOffset = 0;
                    var mlen = Math.min(data.length-packetOffset,4096);
                        var i = 0;
                    while(data.length-packetOffset>0) {
                        
                        var send = function(packet,i) {
                        var buffy = new Buffer(4+1+2+2+4+packet.length);
                            buffy.writeUInt32LE(currentPacketID,0);
                            buffy[4] = 2;
                            buffy.writeUInt16LE(sessionID,4+1);
                            buffy.writeUInt16LE(i,4+1+2);
                            buffy.writeUInt32LE(packet.length,4+1+2+2);
                            packet.copy(buffy,4+1+2+2+4);
                            retval.send(buffy);
                       
                    };
                    var mb = new Buffer(mlen);
                    data.copy(mb,0,0,mlen);
                    send(mb,i);
                        packetOffset+=mlen;
                        i++;
                    }
                    
                        currentPacketID++;
                },
                /**
                 * Decodes a packet
                 * @param {Buffer} data
                 * @returns {undefined}
                 */
                decodePacket:function(data) {
                    try {
                    if(data[4] == 2) {
                        var messageID = data.readUInt32LE(0);
                        var _sessionID = data.readUInt16LE(4+1);
                        var packetID = data.readUInt16LE(4+1+2);
                        if(sessionID != _sessionID) {
                            return;
                        }
                        var dlen = data.readUInt32LE(4+1+2+2);
                        if(!reassemblyBuffer[messageID]) {
                            var mray = new Array(Math.ceil(dlen/4096));
                            mray.buffer = new Buffer(dlen);
                            mray.currentLength = 0;
                            reassemblyBuffer[messageID] = mray;
                        }
                        var cBuffer = reassemblyBuffer[messageID];
                        if(cBuffer[packetID]) {
                            return;
                        }
                        var dSegLen = Math.min(dlen-cBuffer.currentLength,data.length-(4+1+2+2));
                        cBuffer.currentLength+=dSegLen;
                        cBuffer[packetID] = true;
                        data.copy(cBuffer.buffer,4096*packetID,4+1+2+2+4,4+1+2+2+4+dSegLen);
                        if(cBuffer.currentLength >= dlen) {
                            //We have a packet!
                            reassemblyBuffer[messageID] = null;
                            Protected.ntfyPacket(cBuffer.buffer);
                        }
                    }
                }catch(er) {
                    
                }
                },
                /**
                 * Gets the current session identifier
                 * @returns {Number|Session.CID|Object}
                 */
                getSessionID:function() {
                    return sessionID;
                },
                /**
                 * Sets the current session ID for a remote session
                 * @param {Number} remoteID
                 * @returns {undefined}
                 */
                setSessionID:function(remoteID) {
                    Session.available.push(remoteID);
                    sessionID = remoteID;
                    retval.setSessionID = function(id) {
                        throw 'This function can only be called once.';
                    };
                }
    };
    Protected.ntfyPacket = function (packet) {
        for (var i = 0; i < callbacks.length; i++) {
            callbacks[i](packet);
        }
    };
    return retval;
};
Session.CID = 0;
Session.available = new Array();




/**
 * Cleartext server
 * @param {function(Number)} onReady Callback for server initialization
 * @param {function(Session)} onClientConnect Called when a client connects
 * @param {Number} customPort An optional, custom port number for the server to run on. If unspecified; chooses an available port on the user's system.
 */
var CleartextServer = function (onReady, onClientConnect, customPort) {
    var activeSessions = new Object();

    var s = dgram.createSocket('udp4');
    if (customPort) {
        s.bind(customPort, function () {
            var portno = s.address().port;
            onReady(portno);
        });
    } else {
        s.bind(function () {
            var portno = s.address().port;
            onReady(portno);

        });
    }

    s.on('message', function (msg, rinfo) {
        var entry = rinfo.address + ':' + rinfo.port;
        
        if (!activeSessions[entry]) {
            var session = Session();
            var send = session.send;
            var close = session.close;
            
            session.subclass(function (_protected) {
                activeSessions[entry] = function (data) {
                    _protected.ntfyPacket(data);
                };
                session.send = function (data) {
                    send(data);
                    s.send(data, 0, data.length, rinfo.port,rinfo.address);
                    
                };
                session.close = function () {
                    close();
                    delete activeSessions[entry];
                };
            });
            onClientConnect(session);
        }
        activeSessions[entry](msg);
    });

    return {
        close: function (callback) {
            s.close(callback);
        }, connect: function (remoteAddress, remotePort) {
            var retval = Session();
            var entry = remoteAddress + ':' + remotePort;
            var send = retval.send;
            var close = retval.close;
            retval.subclass(function (_protected) {
                activeSessions[entry] = function (data) {
                    _protected.ntfyPacket(data);
                };
                retval.send = function (data) {
                    send(data);
                    s.send(data, 0, data.length, remotePort,remoteAddress);
                };
                retval.close = function () {
                    close();
                    delete activeSessions[entry];
                };
            });
            return retval;
        }
    };
};


module.exports = {
Session:Session,
CleartextServer:CleartextServer
};
