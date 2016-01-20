var dgram = require('dgram');
var Stream = require('stream');
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
    var defaultMTU = 1024*5;
    var mtu = 1024;
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
            callbacks[id] = undefined;
        },
        /**
         * Subclasses this instance
         */
        subclass: function (callback) {
            callback(Protected);
            return this;
        },
        /**
         * Sets the MTU of this link
         * @param {Number} value The MTU
         * @returns {undefined}
         */
        setMTU:function(value){
            mtu = value;
        },
        /**
         * Gets the current MTU for this link
         * @returns {Number|Session.mtu|value}
         */
        getMTU:function(){
            return mtu;
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
                        var i = 0;
                    while(data.length-packetOffset>0) {
                        
                    var mlen = Math.min(data.length-packetOffset,mtu); //Length of current datagram
                        var send = function(packet,i) {
                        var buffy = new Buffer(4+1+2+2+4+packet.length);
                            buffy.writeUInt32LE(currentPacketID,0);
                            buffy[4] = 2;
                            buffy.writeUInt16LE(sessionID,4+1);
                            buffy.writeUInt16LE(i,4+1+2);
                            buffy.writeUInt32LE(data.length,4+1+2+2);
                            packet.copy(buffy,4+1+2+2+4);
                            retval.send(buffy);
                       
                    };
                    var mb = new Buffer(mlen); //Create datagram buffer
                    data.copy(mb,0,packetOffset,packetOffset+mlen); //Copy data of max size into buffer
                    send(mb,i); //Encode and transmit packet
                        packetOffset+=mlen;
                        i++;
                    }
                    
                        currentPacketID++;
                },
                setPacketId:function(id) {
                    currentPacketID = id;
                },
                getPacketId:function() {
                    return currentPacketID;
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
                            var mray = new Array(Math.ceil(dlen/mtu));
                            mray.buffer = new Buffer(dlen);
                            mray.currentLength = 0;
                            reassemblyBuffer[messageID] = mray;
                        }
                        var cBuffer = reassemblyBuffer[messageID];
                        if(cBuffer[packetID]) {
                            return;
                        }
                        var dSegLen = Math.min(dlen-cBuffer.currentLength,mtu); //Size of current received fragment
                        cBuffer.currentLength+=dSegLen;
                        cBuffer[packetID] = true;
                        data.copy(cBuffer.buffer,mtu*packetID,4+1+2+2+4,4+1+2+2+4+dSegLen);
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
                },
                /**
                 * EXPERIMENTAL -- Makes a large packet session; which can be used to send data larger than the link MTU.
                 * @param {Number} linkMTU The MTU for this link (must be at least 32 bytes). The resultant Session object will split all packets according to this MTU; so choose wisely.
                 * @returns {Session.retval.mkLargePacketSession.s|nm$_session.Session.retval}
                 */
                mkLargePacketSession:function(linkMTU) {
                    var s = Session();
                    var codec = Session(); //Coder/decoder, not to be confused with proprietary multimedia codecs.
                    var codec_old_send = codec.send;
                    codec.send = function(data){
                        codec_old_send(data);
                        retval.send(data);
                    };
                    codec.setMTU(linkMTU);
                    s.subclass(function(protected){
                        var oldclose = s.close();
                        
                        retval.registerReceiveCallback(function(packet){
                            codec.decodePacket(packet);
                        });
                        codec.registerReceiveCallback(function(packet){
                            protected.ntfyPacket(packet);
                        });
                        var oldsend = s.send;
                        s.send = function(data) {
                            oldsend(data);
                            codec.sendPacket(data);
                        };
                        s.close = function() {
                            oldclose();
                            retval.close();
                            codec.close();
                        };
                        
                    });
                    return s;
                },
                /**
                 *  (*EXPERIMENTAL*) Converts this unreliable connection to reliable NodeJS streams.
                 */
                asStream:function() {
                    var getDiff = function(tref) {
                        var tdiff = process.hrtime(tref);
                            //Scale tdiff to milliseconds
                            tdiff[1]/=1000000;
                            tdiff = (tdiff[0]*1000)+tdiff[1];
                            return tdiff;
                    };
                    var write = new Stream.Writable();
                    //Retransmit time == estimated RTT (round-trip time) multiplied by 2.
                    //For now, we'll default to 150 milliseconds
                    var linkMTU = defaultMTU; //Current MTU for link
                    var bps = 1024; //Bytes per second
                    var rttavg = 100;
                    var tref = process.hrtime(); //Reference time since last call to _write
                    var retransmitTime = 200;
                    var retries = 0;
                    var timespent = 0;
                    var maxTime = 10000; //Max time to wait for response
                    var lastPacketID = 0;
                    var packetID = 0; //RX frame ID
                    var cb;
                    var read = new Stream.Readable();
                    read._read = function(bytes){};
                    retval.registerReceiveCallback(function(data){
                        switch(data[0]) {
                            case 0:
                                //Data packet
                                if(data.readInt16LE(1) == packetID) {
                                    var ACKFLACK = new Buffer(1+2);
                                    ACKFLACK[0] = 1;
                                    ACKFLACK.writeInt16LE(packetID,1);
                                    retval.sendPacket(ACKFLACK);
                                    lastPacketID = packetID;
                                    packetID = (packetID+1) & (-1>>>16); //Increment by 1 -- 16-bit integer
                                    read.push(data.slice(3));
                                }else {
                                    if(data.readInt16LE(1) == lastPacketID) {
                                        //Retransmit ACKflack (please don't ask about THAT at work!)
                                        var ACKFLACK = new Buffer(1+2);
                                        ACKFLACK[0] = 1;
                                        ACKFLACK.writeInt16LE(lastPacketID,1);
                                        retval.sendPacket(ACKFLACK);
                                    }
                                }
                                break;
                            case 1:
                                //ACK packet
                                if(data.readInt16LE(1) == packetID) {
                                    lastPacketID = packetID;
                                    packetID = (packetID+1) & (-1 >>> 16);
                                    if(cb) {
                                        cb(true);
                                    }
                                }
                                break;
                        }
                    });
                    var finished = true;
                    write._write = function(data,encoding,callback) {
                        var dpos = 0;
                        var sendframe = function() {
                            if(dpos >= data.length) {
                                callback();
                            }else {
                                //TODO: Set current LinkMTU based on bitrate and time since last transmission, assuming MTU unchanged
                                var tdiff = getDiff(tref); //Time elapsed since last transmission
                                //Compute available bandwidth
                                //We know we can send bps bytes per second, and it's been tdiff since last transmission
                                var bandwidth = (bps*tdiff*1000) | 0; //Available transmission bandwidth per interval
                                if(bandwidth != 0) {
                                 linkMTU = bandwidth*2; //Send data as fast as possible
                                }
                                
                                var avail = Math.min(linkMTU,data.length-dpos);
                                write.__write(data.slice(dpos,avail+dpos),null,function(err){
                                    if(err) {
                                        callback(err);
                                    }else {
                                        //Move onto next frame if done.
                                        sendframe();
                                    }
                                });
                                dpos+=avail;
                            }
                        };
                        sendframe();
                    };
                    write.__write = function(data,encoding,callback) {
                        if(!finished){throw 'Unfinished business'};
                        var pid = retval.getPacketId();
                        finished = false;
                       var packet = new Buffer(1+2+data.length);
                       packet[0] = 0;
                       packet.writeInt16LE(packetID,1);
                        data.copy(packet,3);
                        tref = process.hrtime();
                        var tfunc = function(){
                            /*linkMTU = linkMTU/2 | 0;
                            if(linkMTU == 0) {
                                linkMTU = 1024;
                            }*/
                            timespent = getDiff(tref);
                            if(timespent>=maxTime) {
                                clearTimeout(transmitTimer);
                                
                                callback(new Error('Retransmit threshold exceeded with retransmit timeout = '+retransmitTime+', MTU = '+linkMTU+', BPS = '+bps));
                            }
                            retries++;
                            retval.setPacketId(pid);
                            retval.sendPacket(packet);
                            retval.setPacketId(pid+1);
                            retransmitTime*=2;
                            transmitTimer = setTimeout(tfunc,retransmitTime);
                        };
                        //TODO: To fix this -- approach the problem differently
                        //Measure how many bytes/second we can transmit reliably
                        //and enqueue packets to be sent that many per second intervals, rather
                        //than complex window resizing and all that other goofy stuff.
                        
                        var transmitTimer = setTimeout(tfunc,retransmitTime);
                        cb = function() {
                            finished = true;
                            clearTimeout(transmitTimer);
                            retries = 0;
                            
                            var tdiff = getDiff(tref);
                            var bytes = packet.length;
                            rttavg = (rttavg+tdiff)/2;
                            retransmitTime = rttavg*4;
                            bps = (bytes/tdiff)*1000; //Bytes per second
                            //linkMTU*=1.5;
                            cb = undefined;
                            callback();
                        };
                       retval.sendPacket(packet);
                       
                    };
                    return {read:read,write:write,close:function(){retval.close();}};
                }
    };
    Protected.ntfyPacket = function (packet) {
        for (var i = 0; i < callbacks.length; i++) {
            if(callbacks[i]) {
                callbacks[i](packet);
            }
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
            session.remoteEndpoint = rinfo;
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
            onClientConnect(session.mkLargePacketSession(32));
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
            return retval.mkLargePacketSession(32);
        }
    };
};



module.exports = {
Session:Session,
CleartextServer:CleartextServer
};