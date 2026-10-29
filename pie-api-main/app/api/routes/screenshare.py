from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException, Request
from sqlalchemy.orm import Session
from app.core.auth import get_current_user, websocket_user
from app.core.database import get_db
from app.core.tunnel import own_join_through_tunnel
from app.models.db.user import User
from fastapi.responses import JSONResponse
from app.services.pubsub_service import redis_pubsub
import json
import asyncio
from typing import Dict, Any, List, Optional

router = APIRouter()

# In-memory stores (consider moving to Redis for persistence and scale)
connected_clients = {}
connected_monitors = {}

# Channel name format: screenshare:{session_id}:{client/monitor}:{nmec}
def get_client_channel(session_id: str, nmec: str) -> str:
    return f"screenshare:{session_id}:client:{nmec}"

def get_monitor_channel(session_id: str) -> str:
    return f"screenshare:{session_id}:monitor"

def _is_teacher(user) -> bool:
    return user is not None and user.role in ["admin", "teacher"]

def _is_joined_student(db, request, user, session_id, nmec) -> bool:
    """The student themself, joined on the device the request comes through."""
    try:
        session_id, nmec = int(session_id), int(nmec)
    except (TypeError, ValueError):
        return False
    return user is not None and user.nmec == nmec and \
        own_join_through_tunnel(db, request, user, session_id=session_id) is not None

# A student's own screen, from the device they joined on.
@router.websocket("/ws/client/{session_id}/{nmec}")
async def websocket_client_endpoint(websocket: WebSocket, session_id: str, nmec: str, db: Session = Depends(get_db)):
    if not _is_joined_student(db, websocket, websocket_user(websocket, db), session_id, nmec):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    
    # Register this client
    channel = get_client_channel(session_id, nmec)
    connected_clients[f"{session_id}_{nmec}"] = websocket
    
    # Subscribe to this client's channel
    pubsub = redis_pubsub.redis.pubsub()
    await pubsub.subscribe(channel)
    
    # Notify monitors that this client connected
    monitor_channel = get_monitor_channel(session_id)
    await redis_pubsub.publish(monitor_channel, json.dumps({
        "type": "connection_status",
        "connected": True,
        "nmec": nmec,
        "message": "Student is connected"
    }))
    
    try:
        # Start listening task for Redis messages
        redis_task = asyncio.create_task(handle_redis_messages(pubsub, websocket))
        
        # Handle messages from client
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Based on message type, route to appropriate recipients
            if message.get("type") == "offer":
                # Client is sending an offer to the monitor
                await redis_pubsub.publish(monitor_channel, json.dumps({
                    "type": "offer",
                    "sdp": message.get("sdp"),
                    "nmec": nmec,
                    "sessionId": session_id
                }))
            
            elif message.get("type") == "ice-candidate":
                # Forward ICE candidate to monitor
                await redis_pubsub.publish(monitor_channel, json.dumps({
                    "type": "ice-candidate",
                    "candidate": message.get("candidate"),
                    "nmec": nmec,
                    "sessionId": session_id
                }))
            
            elif message.get("type") == "screen_share_stopped":
                # Client stopped sharing
                await redis_pubsub.publish(monitor_channel, json.dumps({
                    "type": "screen_share_stopped",
                    "nmec": nmec,
                    "sessionId": session_id
                }))
            
            elif message.get("type") == "pong":
                # Keep-alive response, do nothing
                pass
    
    except WebSocketDisconnect:
        print(f"Client disconnected: {session_id}_{nmec}")
    except Exception as e:
        print(f"Error in client websocket: {e}")
    finally:
        # Clean up resources
        connected_clients.pop(f"{session_id}_{nmec}", None)
        await pubsub.unsubscribe(channel)
        redis_task.cancel()
        
        # Notify monitors that this client disconnected
        await redis_pubsub.publish(monitor_channel, json.dumps({
            "type": "connection_status",
            "connected": False,
            "nmec": nmec,
            "message": "Student disconnected"
        }))

# Watching the students' screens: teachers and admins.
@router.websocket("/ws/monitor/{session_id}")
async def websocket_monitor_endpoint(websocket: WebSocket, session_id: str, db: Session = Depends(get_db)):
    if not _is_teacher(websocket_user(websocket, db)):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    
    # Register this monitor
    channel = get_monitor_channel(session_id)
    if session_id not in connected_monitors:
        connected_monitors[session_id] = []
    connected_monitors[session_id].append(websocket)
    
    # Subscribe to monitor channel
    pubsub = redis_pubsub.redis.pubsub()
    await pubsub.subscribe(channel)
    
    try:
        # Start listening task for Redis messages
        redis_task = asyncio.create_task(handle_redis_messages(pubsub, websocket))
        
        # Handle messages from monitor
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Route messages based on type
            if message.get("type") == "request_screen_share":
                # Monitor requesting screen share from specific student
                nmec = message.get("userNmec")
                client_channel = get_client_channel(session_id, nmec)
                
                # Forward request to student
                await redis_pubsub.publish(client_channel, json.dumps({
                    "type": "screen_share_request",
                    "sessionId": session_id
                }))
                
                # Confirm to monitor
                await websocket.send_text(json.dumps({
                    "type": "status",
                    "message": f"Screen share request sent to student {nmec}"
                }))
                
            elif message.get("type") == "answer":
                # Monitor sending answer to client
                nmec = message.get("userNmec")
                client_channel = get_client_channel(session_id, nmec)
                
                await redis_pubsub.publish(client_channel, json.dumps({
                    "type": "webrtc_answer",
                    "sdp": message.get("sdp")
                }))
                
            elif message.get("type") == "ice-candidate":
                # Forward ICE candidate to client
                nmec = message.get("userNmec")
                client_channel = get_client_channel(session_id, nmec)
                
                await redis_pubsub.publish(client_channel, json.dumps({
                    "type": "webrtc_ice_candidate",
                    "candidate": message.get("candidate")
                }))
                
            elif message.get("type") == "stop_screen_share":
                # Request to stop sharing
                nmec = message.get("userNmec")
                client_channel = get_client_channel(session_id, nmec)
                
                await redis_pubsub.publish(client_channel, json.dumps({
                    "type": "screen_share_stop",
                    "sessionId": session_id
                }))
                
                await websocket.send_text(json.dumps({
                    "type": "status",
                    "message": "Stop request sent"
                }))
                
            elif message.get("type") == "check_connection":
                # Check if student is connected
                nmec = message.get("userNmec")
                client_key = f"{session_id}_{nmec}"
                
                is_connected = client_key in connected_clients
                await websocket.send_text(json.dumps({
                    "type": "status",
                    "message": "Student is connected" if is_connected else "Student is not connected",
                    "connected": is_connected
                }))
    
    except WebSocketDisconnect:
        print(f"Monitor disconnected from session {session_id}")
    except Exception as e:
        print(f"Error in monitor websocket: {e}")
    finally:
        # Clean up resources
        if session_id in connected_monitors:
            connected_monitors[session_id].remove(websocket)
            if not connected_monitors[session_id]:
                connected_monitors.pop(session_id)
        
        await pubsub.unsubscribe(channel)
        redis_task.cancel()

# Helper function to handle Redis PubSub messages
async def handle_redis_messages(pubsub, websocket):
    while True:
        try:
            message = await pubsub.get_message(ignore_subscribe_messages=True)
            if message:
                await websocket.send_text(message["data"])
        except Exception as e:
            print(f"Error handling Redis message: {e}")
            break
        await asyncio.sleep(0.01)  # Small sleep to avoid CPU spinning

# REST endpoints to support legacy code and direct HTTP requests

@router.post("/offer")
async def receive_offer(
    data: Dict[str, Any],
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session_id = data.get("sessionId")
    nmec = data.get("nmec")
    
    if not session_id or not nmec:
        raise HTTPException(status_code=400, detail="sessionId and nmec are required")
    # An offer is the student's screen: only from the student themself.
    if not _is_joined_student(db, request, current_user, session_id, nmec):
        raise HTTPException(status_code=403, detail="Not joined on this device")
    
    # Publish to monitor channel
    monitor_channel = get_monitor_channel(session_id)
    await redis_pubsub.publish(monitor_channel, json.dumps({
        "type": "offer",
        "sdp": data.get("sdp"),
        "nmec": nmec,
        "sessionId": session_id
    }))
    
    return {"status": "success"}

@router.post("/ice-candidate")
async def receive_ice_candidate(
    data: Dict[str, Any],
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session_id = data.get("sessionId")
    nmec = data.get("nmec")
    source = data.get("source", "student")
    
    if not session_id:
        raise HTTPException(status_code=400, detail="sessionId is required")
    # From the student themself, or from a teacher watching.
    allowed = _is_joined_student(db, request, current_user, session_id, nmec) if source == "student" \
        else _is_teacher(current_user)
    if not allowed:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    if source == "student":
        # Student to monitor
        monitor_channel = get_monitor_channel(session_id)
        await redis_pubsub.publish(monitor_channel, json.dumps({
            "type": "ice-candidate",
            "candidate": data.get("candidate"),
            "nmec": nmec,
            "sessionId": session_id
        }))
    else:
        # Monitor to student
        if not nmec:
            raise HTTPException(status_code=400, detail="nmec is required")
        
        client_channel = get_client_channel(session_id, nmec)
        await redis_pubsub.publish(client_channel, json.dumps({
            "type": "webrtc_ice_candidate", 
            "candidate": data.get("candidate"),
            "sessionId": session_id
        }))
    
    return {"status": "success"}