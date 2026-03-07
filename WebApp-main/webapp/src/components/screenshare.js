"use client";
import { useEffect, useRef, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");

export default function ScreenViewer({ user_nmec, sessionId, courseId, examId }) {
  const videoRef = useRef(null);
  const peerConnection = useRef(null);
  const webSocket = useRef(null);
  const processingOffer = useRef(false);
  const [status, setStatus] = useState("disconnected");
  const [error, setError] = useState(null);
  const [videoInfo, setVideoInfo] = useState({});
  const [showPlayButton, setShowPlayButton] = useState(false);
  const [studentStatus, setStudentStatus] = useState("unknown");
  const [signalState, setSignalState] = useState("stable");

  // Console logger with timestamp for debugging
  const logWithTime = (message, data) => {
    const time = new Date().toLocaleTimeString();
  };

  // Request screen sharing from student
  const requestScreenShare = async () => {
    if (webSocket.current?.readyState === WebSocket.OPEN) {
      logWithTime(`Requesting screen share for student ${user_nmec}`);
      
      webSocket.current.send(
        JSON.stringify({
          type: "request_screen_share",
          userNmec: user_nmec,
          sessionId: sessionId
        })
      );
      
      setStatus("requesting");
    } else {
      const errorMsg = "WebSocket not connected. Cannot request screen share.";
      logWithTime(errorMsg);
      setError(errorMsg);
    }
  };

  // Stop screen sharing
  const stopScreenShare = () => {
    if (webSocket.current?.readyState !== WebSocket.OPEN) {
      logWithTime("Cannot send stop request: WebSocket not connected");
      return;
    }

    try {
      logWithTime("Sending stop request to server", { user_nmec, sessionId });

      webSocket.current.send(
        JSON.stringify({
          type: "stop_screen_share",
          userNmec: user_nmec,
          sessionId: sessionId,
        })
      );

      logWithTime("Stop screen share request sent to student");
      setStatus("waiting");
      setError(null);
    } catch (err) {
      logWithTime("Failed to send stop screen share request:", err);
      setError(`Failed to stop screen share: ${err.message}`);
    }
  };

  // Clean up connections
  const cleanupConnections = () => {
    logWithTime("Cleaning up connections");
    
    // Reset processing flag
    processingOffer.current = false;
    
    // Close and clear peer connection
    if (peerConnection.current) {
      try {
        peerConnection.current.ontrack = null;
        peerConnection.current.onicecandidate = null;
        peerConnection.current.oniceconnectionstatechange = null;
        peerConnection.current.onsignalingstatechange = null;
        peerConnection.current.onicecandidateerror = null;
        peerConnection.current.onconnectionstatechange = null;
        peerConnection.current.close();
      } catch (err) {
        logWithTime("Error closing peer connection:", err);
      }
      peerConnection.current = null;
    }

    // Close WebSocket
    if (webSocket.current?.readyState === WebSocket.OPEN) {
      try {
        webSocket.current.close();
      } catch (err) {
        logWithTime("Error closing WebSocket:", err);
      }
    }
    webSocket.current = null;

    // Clear video stream
    if (videoRef.current?.srcObject) {
      try {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        videoRef.current.srcObject = null;
      } catch (err) {
        logWithTime("Error stopping video tracks:", err);
      }
    }
    
    setSignalState("stable");
  };

  // Initialize WebSocket connection
  const initializeConnection = () => {
    cleanupConnections();
  
    try {
      logWithTime(`Setting up WebSocket connection for session ${sessionId}`);
  
      const configuration = {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      };
  
      // Connect to the WebSocket server
      const ws = new WebSocket(`${WS_BASE_URL}/screenshare/ws/monitor/${sessionId}`);
      webSocket.current = ws;
  
      ws.onopen = () => {
        logWithTime("WebSocket connected successfully");
        setStatus("connected");
        setError(null);
        
        // Check student connection
        checkStudentConnection();
      };
      
      // Check if student is connected
      const checkStudentConnection = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "check_connection",
              userNmec: user_nmec,
              sessionId: sessionId
            })
          );
        }
      };
      
      // Handle incoming WebSocket messages
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          logWithTime(`Received ${message.type} message`, message);
  
          switch(message.type) {
            case "offer":
              // Use a queue mechanism for offer handling to prevent race conditions
              if (!processingOffer.current) {
                processingOffer.current = true;
                handleOffer(message, configuration)
                  .finally(() => {
                    processingOffer.current = false;
                  });
              } else {
                logWithTime("Already processing an offer, ignoring duplicate");
              }
              break;
              
            case "ice-candidate":
              if (peerConnection.current) {
                handleIceCandidate(message);
              }
              break;
              
            case "status":
              handleStatusMessage(message);
              break;
              
            case "connection_status":
              handleConnectionStatus(message);
              break;
              
            case "screen_share_stopped":
              handleScreenShareStopped(message);
              break;
              
            case "error":
              logWithTime("Error from server:", message.message);
              setError(message.message || "Unknown error from server");
              if (status === "requesting") {
                setStatus("connected");
              }
              break;
              
            default:
              logWithTime("Unhandled message type:", message.type);
          }
        } catch (err) {
          logWithTime("Error handling WebSocket message", err);
          setError("Failed to process server message");
        }
      };

      // Handle WebSocket errors
      ws.onerror = (event) => {
        logWithTime("WebSocket error:", event);
        setStatus("error");
        setError("WebSocket connection error");
      };

      // Handle WebSocket closure
      ws.onclose = (event) => {
        logWithTime("WebSocket closed:", { code: event.code, reason: event.reason });

        if (status !== "error") {
          setStatus("disconnected");
        }

        if (event.code !== 1000 && event.code !== 1001) {
          setError(`Connection closed: ${event.reason || "Unknown reason"}`);
        }
      };
    } catch (err) {
      logWithTime("Failed to initialize connection:", err);
      setStatus("error");
      setError(err.message || "Connection initialization error");
    }
  };

  // Handle status messages
  const handleStatusMessage = (message) => {
    logWithTime("Status update:", message.message);

    if (message.message.includes("not connected")) {
      setStudentStatus("disconnected");
      setError(`Student ${user_nmec} is not connected`);
    } else if (message.message.includes("sent to student")) {
      setStudentStatus("connected");
      setStatus("waiting");
    } else if (message.message.includes("Student is connected")) {
      setStudentStatus("connected");
      setError(null);
    } else if (message.message.includes("Stop request sent")) {
      logWithTime("Server confirmed stop request was sent");
    }
  };

  // Handle connection status messages
  const handleConnectionStatus = (message) => {
    logWithTime("Connection status:", message);
    setStudentStatus(message.connected ? "connected" : "disconnected");
    
    if (!message.connected) {
      setError(`Student ${user_nmec} is not connected`);
    } else {
      setError(null);
    }
  };

  // Handle screen share stopped message
  const handleScreenShareStopped = (message) => {
    logWithTime("Student stopped sharing screen", message);

    cleanupConnections();
    setStatus("connected");
    setError(null);
    
    // Reinitialize connection after student stops sharing
    setTimeout(() => {
      initializeConnection();
    }, 1000);
  };

  // Handle WebRTC offer
  const handleOffer = async (message, configuration) => {
    try {
      // Check if we already have a connection in the right state
      const currentState = peerConnection.current?.signalingState;
      logWithTime("Handling offer, current signaling state:", currentState || "No connection");
      
      // Close any existing peer connection
      if (peerConnection.current) {
        logWithTime("Closing existing peer connection");
        peerConnection.current.close();
        peerConnection.current = null;
      }
      
      // Create new peer connection
      logWithTime("Creating new RTCPeerConnection");
      const pc = new RTCPeerConnection(configuration);
      peerConnection.current = pc;
      
      // Set up event handlers
      setupPeerConnectionHandlers(pc);
      
      // Set remote description (offer)
      logWithTime("Setting remote description (offer)");
      await pc.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: message.sdp
      }));
      
      // Update UI state
      setSignalState(pc.signalingState);
      logWithTime("Remote description set, current state:", pc.signalingState);
      
      // Create answer
      logWithTime("Creating answer");
      const answer = await pc.createAnswer();
      
      // Apply moderate SDP optimizations (careful not to break anything)
      answer.sdp = optimizeSdpForPerformance(answer.sdp);
      
      // Set local description
      logWithTime("Setting local description (answer)");
      await pc.setLocalDescription(answer);  // Use the answer object directly
      
      // Update UI state
      setSignalState(pc.signalingState);
      logWithTime("Local description set, current state:", pc.signalingState);
      
      // Send answer to server
      logWithTime("Sending answer to server");
      if (webSocket.current?.readyState === WebSocket.OPEN) {
        webSocket.current.send(
          JSON.stringify({
            type: "answer",
            userNmec: user_nmec,
            sdp: pc.localDescription.sdp,
            sessionId: sessionId
          })
        );
        logWithTime("Answer sent successfully");
      } else {
        throw new Error("WebSocket not connected, cannot send answer");
      }
    } catch (err) {
      logWithTime("Error handling offer:", err);
      setStatus("error");
      setError("Failed to process offer: " + err.message);
      
      // Try to recover by cleaning up and restarting after a delay
      cleanupConnections();
      setTimeout(() => {
        initializeConnection();
      }, 2000);
    }
  };

  // Set up peer connection event handlers
  const setupPeerConnectionHandlers = (pc) => {
    // Handle remote tracks (video stream)
    pc.ontrack = (event) => {
      logWithTime("Received remote track", { 
        kind: event.track.kind,
        streamId: event.streams?.[0]?.id
      });
      
      if (videoRef.current && event.streams && event.streams[0]) {
        const numTracks = event.streams[0].getTracks().length;
        logWithTime(`Stream has ${numTracks} tracks`);
        
        // Apply video optimizations
        videoRef.current.playsInline = true;
        videoRef.current.muted = true;
        videoRef.current.srcObject = event.streams[0];
        
        setStatus("streaming");

        // Try to play video
        videoRef.current.play()
          .then(() => logWithTime("Video playback started automatically"))
          .catch((err) => {
            logWithTime("Autoplay prevented:", err);
            setShowPlayButton(true);
          });
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && webSocket.current?.readyState === WebSocket.OPEN) {
        logWithTime("Generated ICE candidate");
        webSocket.current.send(
          JSON.stringify({
            type: "ice-candidate",
            userNmec: user_nmec,
            candidate: event.candidate,
            sessionId: sessionId,
            source: "monitor",
          })
        );
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      logWithTime("Connection state changed:", state);

      if (state === "failed") {
        setStatus("failed");
        setError("Connection failed. Try requesting again.");
        
        // Attempt recovery
        setTimeout(() => {
          if (status === "failed") {
            initializeConnection();
          }
        }, 3000);
      } else if (state === "disconnected") {
        setStatus("disconnected");
      } else if (state === "connected") {
        setStatus("streaming");
        setError(null);
      }
    };
    
    // Monitor signaling state changes
    pc.onsignalingstatechange = () => {
      logWithTime("Signaling state changed:", pc.signalingState);
      setSignalState(pc.signalingState);
    };
    
    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      logWithTime("ICE connection state:", pc.iceConnectionState);
      
      if (pc.iceConnectionState === "failed") {
        logWithTime("ICE connection failed, attempting restart");
        pc.restartIce();
      }
    };
    
    // Handle connection errors
    pc.onicecandidateerror = (event) => {
      logWithTime("ICE candidate error:", event);
    };
  };

  // Handle incoming ICE candidates
  const handleIceCandidate = async (message) => {
    if (!peerConnection.current) {
      logWithTime("Ignoring ICE candidate - no peer connection");
      return;
    }
    
    try {
      logWithTime("Adding ICE candidate from student");
      await peerConnection.current.addIceCandidate(new RTCIceCandidate(message.candidate));
    } catch (err) {
      logWithTime("Error adding ICE candidate:", err);
      // Non-fatal error, don't reset the connection
    }
  };

  // Optimize SDP for performance (minimal changes to avoid breaking anything)
  const optimizeSdpForPerformance = (sdp) => {
    // Very conservative SDP optimization
    let lines = sdp.split('\r\n');
    
    // Find video m-line
    const mLineIndex = lines.findIndex(line => line.startsWith('m=video'));
    if (mLineIndex === -1) return sdp;
    
    // Set reasonable bitrate (3 Mbps is safe for most connections)
    const targetBitrate = 3000;
    const bitrateLineIndex = lines.findIndex(line => line.startsWith('b=AS:'));
    
    if (bitrateLineIndex === -1) {
      // Add bandwidth limit
      lines.splice(mLineIndex + 1, 0, `b=AS:${targetBitrate}`);
    } else {
      lines[bitrateLineIndex] = `b=AS:${targetBitrate}`;
    }
    
    return lines.join('\r\n');
  };

  // Handle manual play when autoplay is blocked
  const handleForcePlay = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.play()
        .then(() => {
          logWithTime("Video playback started manually");
          setShowPlayButton(false);
        })
        .catch((err) => {
          logWithTime("Failed to play video manually:", err);
        });
    }
  };

  // Set up connection on component mount
  useEffect(() => {
    logWithTime("Component mounted, initializing connection");
    initializeConnection();

    // Heartbeat to check connection status every 15 seconds
    const heartbeat = setInterval(() => {
      if (webSocket.current?.readyState === WebSocket.OPEN) {
        webSocket.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 15000);

    return () => {
      logWithTime("Component unmounting");
      clearInterval(heartbeat);
      
      if (status === "streaming" && webSocket.current) {
        stopScreenShare();
        // Give it a moment to send the message
        setTimeout(cleanupConnections, 300);
      } else {
        cleanupConnections();
      }
    };
  }, [user_nmec, sessionId, courseId, examId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Monitor video performance without causing unnecessary renders
  useEffect(() => {
    if (videoRef.current && status === "streaming") {
      let lastTime = 0;
      let frameCount = 0;
      let animationFrameId = null;
      
      const checkPerformance = () => {
        if (!videoRef.current) return;
        
        frameCount++;
        const now = performance.now();
        
        // Calculate FPS every second
        if (now - lastTime >= 1000) {
          const fps = Math.round(frameCount * 1000 / (now - lastTime));
          
          setVideoInfo({
            fps,
            resolution: videoRef.current.videoWidth + 'x' + videoRef.current.videoHeight,
            timestamp: new Date().toISOString()
          });
          
          frameCount = 0;
          lastTime = now;
        }
        
        if (status === "streaming") {
          animationFrameId = requestAnimationFrame(checkPerformance);
        }
      };
      
      lastTime = performance.now();
      animationFrameId = requestAnimationFrame(checkPerformance);
      
      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }
  }, [status]);

  // Try to reconnect if connection fails
  useEffect(() => {
    if (status === "error" || status === "failed") {
      const reconnectTimer = setTimeout(() => {
        logWithTime("Attempting automatic reconnection");
        initializeConnection();
      }, 5000);
      
      return () => clearTimeout(reconnectTimer);
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render UI
  return (
    <div className="relative">
      <div className="bg-black rounded-lg overflow-hidden w-full h-[700px]">
        {/* Status UI */}
        {status === "connected" && (
          <div className="flex flex-col items-center justify-center h-full text-white">
            <p className="mb-4">
              {studentStatus === "disconnected"
                ? `Student ${user_nmec} is not connected`
                : "Ready to request student screen"}
            </p>
            <button
              onClick={requestScreenShare}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              disabled={studentStatus === "disconnected"}
            >
              Request Screen Share
            </button>
            {studentStatus === "disconnected" && (
              <p className="mt-4 text-sm text-yellow-300">
                The student is not connected to the session
              </p>
            )}
          </div>
        )}

        {status === "requesting" && (
          <div className="flex items-center justify-center h-full text-white">
            <p>Sending request to student...</p>
          </div>
        )}

        {status === "waiting" && (
          <div className="flex items-center justify-center h-full text-white">
            <p>Waiting for student to share screen...</p>
          </div>
        )}

        {(status === "failed" || status === "error") && (
          <div className="flex flex-col items-center justify-center h-full text-white">
            <p className="mb-4">Error: {error || "Connection failed"}</p>
            <div className="flex space-x-4">
              <button
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </button>
              <button
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                onClick={requestScreenShare}
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Video Element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-contain ${
            status !== "streaming" ? "hidden" : ""
          }`}
        ></video>

        {/* Stop sharing button when streaming */}
        {status === "streaming" && (
          <div className="absolute top-4 right-4">
            <button
              onClick={stopScreenShare}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 flex items-center"
            >
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Stop Sharing
            </button>
          </div>
        )}

        {/* Play button for browsers with autoplay restrictions */}
        {showPlayButton && status === "streaming" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
            <button
              onClick={handleForcePlay}
              className="px-6 py-3 bg-blue-600 text-white rounded-full text-lg hover:bg-blue-700 flex items-center"
            >
              <svg
                className="w-6 h-6 mr-2"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
              Play Video
            </button>
          </div>
        )}

        {/* Performance debug overlay */}
        {status === "streaming" && videoInfo.fps && (
          <div className="absolute top-4 left-4 bg-black bg-opacity-50 p-2 rounded text-white text-xs">
            <div>FPS: {videoInfo.fps}</div>
            <div>Resolution: {videoInfo.resolution || 'Unknown'}</div>
            <div>State: {signalState}</div>
          </div>
        )}
      </div>

      {/* Status indicator */}
      <div className="absolute bottom-4 right-4 bg-gray-800 text-white px-3 py-1 rounded-full text-sm">
        {status === "streaming" ? "Live" : status}
      </div>
    </div>
  );
}