import { MessageTypes } from "./constants.js";

export default class Message {
    constructor (type, payload) {
        this.type = type;
        this.payload = payload;
    }

    encodeMessage () {
        const typeByte = this.type;
        const payloadBytes = this.payload;

        // Combine type byte and payload bytes into a single Uint8Array
        const messageBytes = new Uint8Array(1 + payloadBytes.length);
        messageBytes[0] = typeByte; // First byte: Message type
        messageBytes.set(payloadBytes, 1); // Copy payload bytes starting from the second byte

        return messageBytes;
    }

    static createJoinMessage (name, equippedSkin, preferredColorIndex, fingerprint) {
        // Truncate the name if it exceeds 12 characters
        name = name.slice(0, 12);

        // Encode the name as bytes
        const nameBytes = new TextEncoder().encode(name);

        // Convert equippedSkin to a single byte. We now map Supabase skins to byte IDs client-side.
        let skinByte = 0;
        if (typeof equippedSkin === 'number' && !Number.isNaN(equippedSkin)) {
            skinByte = Math.max(0, Math.min(255, equippedSkin));
        }
        
        const skinByteArray = new Uint8Array(1);
        skinByteArray[0] = skinByte;

        // Preferred non-skin color index (palette index on server)
        let colorIndexByte = 0;
        if (typeof preferredColorIndex === 'number' && !Number.isNaN(preferredColorIndex)) {
            colorIndexByte = Math.max(0, Math.min(255, preferredColorIndex));
        }

        const colorByteArray = new Uint8Array(1);
        colorByteArray[0] = colorIndexByte;

        // Convert the fingerprint to a 4-byte Uint8Array (32-bit integer)
        const fingerprintBytes = new Uint8Array(4);
        fingerprintBytes[0] = (fingerprint >> 24) & 0xFF; // Most significant byte
        fingerprintBytes[1] = (fingerprint >> 16) & 0xFF;
        fingerprintBytes[2] = (fingerprint >> 8) & 0xFF;
        fingerprintBytes[3] = fingerprint & 0xFF; // Least significant byte

        // Calculate the total payload size:
        // name + 1 byte skin + 1 byte preferred color + 4 bytes fingerprint
        const payload = new Uint8Array(nameBytes.length + 1 + 1 + fingerprintBytes.length);

        // Copy the name bytes starting from the first byte
        payload.set(nameBytes, 0);

        // Copy the skin byte
        payload.set(skinByteArray, nameBytes.length);

        // Copy preferred color byte right after skin byte
        payload.set(colorByteArray, nameBytes.length + 1);

        // Append the fingerprint bytes at the end of the payload
        payload.set(fingerprintBytes, nameBytes.length + 2);

        // Return the message with the appropriate type and payload
        return new Message(MessageTypes.JOIN, payload);
    }


    static createRequestResyncMessage () {
        const payload = new Uint8Array(1);
        return new Message(MessageTypes.CLIENT_REQUEST_RESYNC, payload);
    }

    static createRequestSkinDataMessage () {
        const payload = new Uint8Array(1);
        return new Message(MessageTypes.CLIENT_REQUEST_SKIN_DATA, payload);
    }

    static createPlaceBuildingMessage (buildingType, position, isDefenseAction = false, placementRotationStep = 0) {
        // Create a buffer to hold the payload
        // 1 byte for buildingType, 4 bytes for x (float32), and 4 bytes for y (float32)
        const payload = new Uint8Array(1 + 4 + 4);

        // Byte layout:
        // bit7 = defend/remount action
        // bits4..6 = placement rotation step (0..7)
        // bits0..3 = building type (0..15)
        const encodedBuildingType =
            (buildingType & 0x0F) |
            ((placementRotationStep & 0x07) << 4) |
            (isDefenseAction ? 0x80 : 0);
        payload[0] = encodedBuildingType;

        // Create a DataView for writing float32 values into the buffer
        const dataView = new DataView(payload.buffer);

        // Set the x position as a float32 (4 bytes)
        dataView.setFloat32(1, position.x, false); // false for big-endian
        // Set the y position as a float32 (4 bytes)
        dataView.setFloat32(5, position.y, false); // false for big-endian

        // Return the message object with the payload
        return new Message(MessageTypes.CLIENT_PLACE_BUILDING, payload);
    }

    static createRemoveBuildingsMessage(buildingIDs, neutralBaseID = null) {
        if (!Array.isArray(buildingIDs) || buildingIDs.length === 0) {
            throw new Error("buildingIDs must be a non-empty array");
        }
    
        // Determine if neutralBaseID is provided (it can be 0, so explicitly check for null/undefined)
        const isNeutralBaseProvided = neutralBaseID !== null && neutralBaseID !== undefined;
    
        // Calculate the payload length:
        // 1 byte for the flag, buildingIDs length, and 1 byte for neutralBaseID if provided
        const payloadLength = buildingIDs.length + (isNeutralBaseProvided ? 2 : 1);
        const payload = new Uint8Array(payloadLength); // Create the array with the correct length
    
        let offset = 0;
    
        // Set the flag byte: 0 means no neutralBaseID, 1 means neutralBaseID is included
        payload[offset++] = isNeutralBaseProvided ? 1 : 0;
    
        // If neutralBaseID is provided, store it in the next byte
        if (isNeutralBaseProvided) {
            payload[offset++] = neutralBaseID;
        }
    
        // Fill the payload with building IDs starting at the current offset
        buildingIDs.forEach((buildingID) => {
            payload[offset++] = buildingID; // Store each buildingID starting from the current offset
        });
    
        return new Message(MessageTypes.CLIENT_REMOVE_BUILDINGS, payload);
    }

    static createUpgradeBuildingsMessage(buildingIDs, buildingVariant, neutralBaseID = null) {
        if (!Array.isArray(buildingIDs) || buildingIDs.length === 0) {
            throw new Error("buildingIDs must be a non-empty array");
        }
    
        // Determine if neutralBaseID is provided (it can be 0, so explicitly check for null/undefined)
        const isNeutralBaseProvided = neutralBaseID !== null && neutralBaseID !== undefined;
    
        // Calculate the payload length:
        // 1 byte for the flag, buildingIDs length, 1 byte for neutralBaseID if provided, and 1 byte for buildingVariant
        const payloadLength = buildingIDs.length + (isNeutralBaseProvided ? 2 : 1) + 1;
        const payload = new Uint8Array(payloadLength); // Create the array with the correct length
    
        let offset = 0;
    
        // Set the flag byte: 0 means no neutralBaseID, 1 means neutralBaseID is included
        payload[offset++] = isNeutralBaseProvided ? 1 : 0;
    
        // If neutralBaseID is provided, store it in the next byte
        if (isNeutralBaseProvided) {
            payload[offset++] = neutralBaseID;
        }
    
        // Store buildingVariant
        payload[offset++] = buildingVariant;
    
        // Fill the payload with building IDs starting at the current offset
        buildingIDs.forEach((buildingID) => {
            payload[offset++] = buildingID; // Store each buildingID starting from the current offset
        });
    
        return new Message(MessageTypes.CLIENT_UPGRADE_BUILDINGS, payload);
    }

    static createMoveUnitsMessage (units, targetPosition) {
        const payload = new Uint8Array(1 + units.length + 4); // 4 bytes for position
        payload[0] = units.length;
        payload[1] = (targetPosition.x >> 8) & 0xFF; // High byte of x
        payload[2] = targetPosition.x & 0xFF;        // Low byte of x
        payload[3] = (targetPosition.y >> 8) & 0xFF; // High byte of y
        payload[4] = targetPosition.y & 0xFF;        // Low byte of y

        // Set unit IDs in payload
        for (let i = 0; i < units.length; i++) {
            payload[5 + i] = units[i].id;
        }

        return new Message(MessageTypes.CLIENT_MOVE_UNITS, payload);
    }

    static createToggleUnitSpawning (barracksID, neutralBaseID = null) {
        const payloadLength = neutralBaseID !== null ? 2 : 1;
        const payload = new Uint8Array(payloadLength);

        payload[0] = barracksID;
        if (neutralBaseID) {
            payload[1] = neutralBaseID;
        }

        return new Message(MessageTypes.TOGGLE_UNIT_SPAWNING, payload);
    }

    static createChatMessageMessage (text) {
        const textBytes = new TextEncoder().encode(text);
        const payload = new Uint8Array(textBytes.length);
        payload.set(textBytes);
        return new Message(MessageTypes.SEND_CHAT_MESSAGE, payload);
    }

    static createCameraUpdateMessage (cameraPosition, zoomLevel) {
        // Create a buffer to hold the payload
        // 2 bytes for x (Int16), 2 bytes for y (Int16), and 1 byte for zoom level (Int8)
        const payload = new Uint8Array(5); // 5 bytes total

        // Create a DataView for writing values into the buffer
        const dataView = new DataView(payload.buffer);

        // Set the camera position x as Int16 (2 bytes)
        dataView.setInt16(0, cameraPosition.x);
        // Set the camera position y as Int16 (2 bytes)
        dataView.setInt16(2, cameraPosition.y);

        const scaledZoom = zoomLevel * 10;  // 0.5 _. 5, 1.5 -> 15
        dataView.setUint8(4, scaledZoom);

        return new Message(MessageTypes.CLIENT_CAMERA_UPDATE, payload);
    }

    static createBuyCommanderMessage () {
        const payload = new Uint8Array(0)
        return new Message(MessageTypes.BUY_COMMANDER, payload);
    }

    static createBuyRepairMessage () {
        const payload = new Uint8Array(0)
        return new Message(MessageTypes.BUY_REPAIR, payload);
    }

    static createBuyRelocateBaseMessage (position = null) {
        let payload = new Uint8Array(0);
        if (position) {
            payload = new Uint8Array(4);
            const dataView = new DataView(payload.buffer);
            dataView.setInt16(0, position.x);
            dataView.setInt16(2, position.y);
        }
        return new Message(MessageTypes.BUY_RELOCATE_BASE, payload);
    }

    static createPlayerActivityMessage() {
        const payload = new Uint8Array(0);
        return new Message(MessageTypes.CLIENT_ACTIVITY, payload);
    }

    static createToggleGroupUnitsMessage(isGrouped) {
        const payload = new Uint8Array(1);
        payload[0] = isGrouped ? 1 : 0;
        return new Message(MessageTypes.TOGGLE_GROUP_UNITS, payload);
    }

    static createSendX1ChallengeMessage (targetPlayerID) {
        const payload = new Uint8Array(1);
        payload[0] = targetPlayerID;
        return new Message(MessageTypes.CLIENT_SEND_X1_CHALLENGE, payload);
    }

    static createX1ChallengeResponseMessage (challengerPlayerID, accepted) {
        const payload = new Uint8Array(2);
        payload[0] = challengerPlayerID;
        payload[1] = accepted ? 1 : 0;
        return new Message(MessageTypes.CLIENT_X1_CHALLENGE_RESPONSE, payload);
    }

    static createWatchLeaveBaseMessage (targetPlayerID) {
        const payload = new Uint8Array(1);
        payload[0] = targetPlayerID;
        return new Message(MessageTypes.CLIENT_WATCH_LEAVE_BASE, payload);
    }


}
