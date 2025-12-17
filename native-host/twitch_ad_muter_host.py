#!/usr/bin/env python3
"""
Twitch Ad Muter - Native Messaging Host

This script receives commands from the Firefox extension via the native messaging
protocol and controls macOS system audio mute state using osascript.

Protocol:
- Messages are framed with a 4-byte little-endian length prefix
- Payload is JSON encoded UTF-8

Commands:
- mute: Mutes system audio
- unmute: Unmutes system audio
- getStatus: Returns current mute state
"""

import json
import struct
import subprocess
import sys
from datetime import datetime
from pathlib import Path


# =============================================================================
# Configuration
# =============================================================================

DEBUG = False
LOG_FILE_PATH = Path.home() / "Library" / "Logs" / "TwitchAdMuter" / "host.log"


# =============================================================================
# Logging
# =============================================================================

def ensure_log_directory():
    """Creates the log directory if it doesn't exist."""
    if DEBUG:
        LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)


def log(message):
    """
    Writes a debug message to the log file.
    Only logs when DEBUG mode is enabled.
    """
    if not DEBUG:
        return

    try:
        ensure_log_directory()
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


# =============================================================================
# Message Reading Exceptions
# =============================================================================

class MessageReadError(Exception):
    """Raised when a message cannot be read or parsed."""
    pass


class EndOfInput(Exception):
    """Raised when EOF is received on stdin."""
    pass


# =============================================================================
# Native Messaging Protocol
# =============================================================================

def read_message():
    """
    Reads a message from stdin using the native messaging protocol.

    Protocol:
    - First 4 bytes: little-endian uint32 indicating message length
    - Following bytes: JSON payload of the specified length

    Returns:
        dict: Parsed JSON message

    Raises:
        EndOfInput: When EOF is received (clean shutdown)
        MessageReadError: When message cannot be read or parsed
    """
    # Read the 4-byte length prefix
    length_bytes = sys.stdin.buffer.read(4)

    if len(length_bytes) == 0:
        log("EOF received on stdin")
        raise EndOfInput()

    if len(length_bytes) != 4:
        error_msg = f"Invalid length prefix: expected 4 bytes, got {len(length_bytes)}"
        log(error_msg)
        raise MessageReadError(error_msg)

    # Unpack as little-endian unsigned 32-bit integer
    message_length = struct.unpack("<I", length_bytes)[0]
    log(f"Message length: {message_length}")

    # Sanity check on message length (max 1MB)
    if message_length > 1024 * 1024:
        error_msg = f"Message too large: {message_length} bytes"
        log(error_msg)
        raise MessageReadError(error_msg)

    # Read the JSON payload
    message_bytes = sys.stdin.buffer.read(message_length)

    if len(message_bytes) != message_length:
        error_msg = f"Incomplete message: expected {message_length} bytes, got {len(message_bytes)}"
        log(error_msg)
        raise MessageReadError(error_msg)

    # Decode and parse JSON
    try:
        message_str = message_bytes.decode("utf-8")
        message = json.loads(message_str)
        log(f"Received message: {message}")
        return message
    except UnicodeDecodeError as e:
        error_msg = f"Invalid UTF-8 encoding: {e}"
        log(error_msg)
        raise MessageReadError(error_msg)
    except json.JSONDecodeError as e:
        error_msg = f"Invalid JSON: {e}"
        log(error_msg)
        raise MessageReadError(error_msg)


def write_message(message):
    """
    Writes a message to stdout using the native messaging protocol.

    Protocol:
    - First 4 bytes: little-endian uint32 indicating message length
    - Following bytes: JSON payload

    Args:
        message: dict to be JSON encoded and sent
    """
    try:
        # Encode message as JSON
        message_str = json.dumps(message)
        message_bytes = message_str.encode("utf-8")

        # Write length prefix (little-endian uint32)
        length_bytes = struct.pack("<I", len(message_bytes))
        sys.stdout.buffer.write(length_bytes)

        # Write message payload
        sys.stdout.buffer.write(message_bytes)

        # Flush to ensure immediate delivery
        sys.stdout.buffer.flush()

        log(f"Sent message: {message}")
    except Exception as e:
        log(f"Failed to write message: {e}")


def send_success_response():
    """Sends a success response."""
    write_message({"success": True})


def send_error_response(error_message):
    """
    Sends an error response.

    Args:
        error_message: Description of the error
    """
    write_message({"success": False, "error": error_message})


def send_status_response(is_muted):
    """
    Sends a mute status response.

    Args:
        is_muted: Boolean indicating if system audio is muted
    """
    write_message({"muted": is_muted})


# =============================================================================
# System Audio Control (macOS)
# =============================================================================

def execute_osascript(script):
    """
    Executes an AppleScript command using osascript.

    Args:
        script: AppleScript code to execute

    Returns:
        tuple: (success: bool, output: str or None, error: str or None)
    """
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            return True, result.stdout.strip(), None
        else:
            error_msg = result.stderr.strip() if result.stderr else "Unknown osascript error"
            log(f"osascript failed: {error_msg}")
            return False, None, error_msg

    except subprocess.TimeoutExpired:
        log("osascript command timed out")
        return False, None, "Command timed out"
    except FileNotFoundError:
        log("osascript not found")
        return False, None, "osascript not found"
    except Exception as e:
        log(f"osascript execution failed: {e}")
        return False, None, str(e)


def mute_system_audio():
    """
    Mutes the system audio output.

    Returns:
        tuple: (success: bool, error: str or None)
    """
    log("Executing mute command")
    success, _, error = execute_osascript("set volume with output muted")
    return success, error


def unmute_system_audio():
    """
    Unmutes the system audio output.

    Returns:
        tuple: (success: bool, error: str or None)
    """
    log("Executing unmute command")
    success, _, error = execute_osascript("set volume without output muted")
    return success, error


def get_mute_status():
    """
    Gets the current mute status of system audio.

    Returns:
        tuple: (success: bool, is_muted: bool or None, error: str or None)
    """
    log("Getting mute status")
    success, output, error = execute_osascript("output muted of (get volume settings)")

    if not success:
        return False, None, error

    is_muted = output.lower() == "true"
    log(f"Mute status: {is_muted}")
    return True, is_muted, None


# =============================================================================
# Command Processing
# =============================================================================

def process_command(message):
    """
    Processes a command message and sends appropriate response.

    Args:
        message: dict containing the command
    """
    if not isinstance(message, dict):
        log("Invalid message format: not a dictionary")
        send_error_response("Invalid message format")
        return

    command = message.get("command")

    if not command:
        log("No command specified in message")
        send_error_response("No command specified")
        return

    log(f"Processing command: {command}")

    if command == "mute":
        success, error = mute_system_audio()
        if success:
            send_success_response()
        else:
            send_error_response(error or "Failed to mute")

    elif command == "unmute":
        success, error = unmute_system_audio()
        if success:
            send_success_response()
        else:
            send_error_response(error or "Failed to unmute")

    elif command == "getStatus":
        success, is_muted, error = get_mute_status()
        if success:
            send_status_response(is_muted)
        else:
            send_error_response(error or "Failed to get status")

    else:
        log(f"Unknown command: {command}")
        send_error_response(f"Unknown command: {command}")


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    """
    Main loop that continuously reads and processes messages from stdin.
    Exits cleanly when stdin is closed (EOF).
    """
    log("Native messaging host started")

    try:
        while True:
            try:
                message = read_message()
                process_command(message)
            except EndOfInput:
                log("End of input received, exiting")
                break
            except MessageReadError as e:
                log(f"Message read error: {e}")
                send_error_response(str(e))

    except KeyboardInterrupt:
        log("Received keyboard interrupt")
    except Exception as e:
        log(f"Unexpected error in main loop: {e}")
    finally:
        log("Native messaging host shutting down")

    sys.exit(0)


if __name__ == "__main__":
    main()
