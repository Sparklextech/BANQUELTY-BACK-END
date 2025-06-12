const express = require('express');
const router = express.Router();
const { ChatRoom, ChatMessage, ServiceProviderProfile, sequelize } = require('../models');
const { authenticateJWT } = require('../middleware/auth');

// Middleware to check if user has access to a chat room
const checkChatAccess = async (req, res, next) => {
  try {
    const roomId = req.params.roomId;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const chatRoom = await ChatRoom.findByPk(roomId);
    if (!chatRoom) {
      return res.status(404).json({ error: 'Chat room not found' });
    }
    
    // Service providers can access chats where they are the provider
    if (userRole === 'service_provider' && chatRoom.serviceProviderId === userId) {
      req.chatRoom = chatRoom;
      return next();
    }
    
    // Users can access their own chats
    if (userRole === 'user' && chatRoom.userId === userId) {
      req.chatRoom = chatRoom;
      return next();
    }
    
    // Admin can access all chats
    if (userRole === 'admin') {
      req.chatRoom = chatRoom;
      return next();
    }
    
    return res.status(403).json({ error: 'You do not have permission to access this chat' });
  } catch (error) {
    return res.status(500).json({ error: 'Error checking chat room access' });
  }
};

// GET /api/service-provider/chat/rooms - Get all chat rooms for the authenticated user
router.get('/rooms', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let whereClause = {};
    
    if (userRole === 'service_provider') {
      whereClause.serviceProviderId = userId;
    } else if (userRole === 'user') {
      whereClause.userId = userId;
    }
    // Admins don't need a where clause - they get all rooms
    
    const chatRooms = await ChatRoom.findAll({
      where: whereClause,
      order: [['lastMessageAt', 'DESC']],
      include: [
        {
          model: ChatMessage,
          as: 'messages',
          limit: 1,
          order: [['createdAt', 'DESC']]
        }
      ]
    });
    
    // For service providers, we need to include user info
    // For users, we need to include service provider info
    // This would be implemented with proper associations in a full system
    
    res.status(200).json(chatRooms);
  } catch (error) {
    console.error('Error fetching chat rooms:', error);
    res.status(500).json({ error: 'Error fetching chat rooms' });
  }
});

// POST /api/service-provider/chat/rooms - Create a new chat room
router.post('/rooms', authenticateJWT, async (req, res) => {
  try {
    const { serviceProviderId } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // For users, they must specify a service provider to chat with
    if (userRole === 'user' && !serviceProviderId) {
      return res.status(400).json({ error: 'Service provider ID is required' });
    }
    
    // If a service provider is creating a chat, they must specify a user
    if (userRole === 'service_provider' && !req.body.userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Check if a chat room already exists between these users
    const existingRoom = await ChatRoom.findOne({
      where: {
        userId: userRole === 'user' ? userId : req.body.userId,
        serviceProviderId: userRole === 'service_provider' ? userId : serviceProviderId
      }
    });
    
    if (existingRoom) {
      return res.status(200).json({
        message: 'Chat room already exists',
        chatRoom: existingRoom
      });
    }
    
    // Create a new chat room
    const chatRoom = await ChatRoom.create({
      userId: userRole === 'user' ? userId : req.body.userId,
      serviceProviderId: userRole === 'service_provider' ? userId : serviceProviderId,
      status: 'active'
    });
    
    res.status(201).json({
      message: 'Chat room created successfully',
      chatRoom
    });
  } catch (error) {
    console.error('Error creating chat room:', error);
    res.status(500).json({ error: 'Error creating chat room' });
  }
});

// GET /api/service-provider/chat/rooms/:roomId/messages - Get messages for a chat room
router.get('/rooms/:roomId/messages', authenticateJWT, checkChatAccess, async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 50;
    
    // Get messages with pagination (most recent first)
    const messages = await ChatMessage.findAll({
      where: { chatRoomId: roomId },
      order: [['createdAt', 'DESC']],
      limit,
      offset: page * limit
    });
    
    // Mark messages as read if the current user is not the sender
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Determine the type of the current user
    const senderType = userRole === 'service_provider' ? 'service_provider' : 'user';
    
    // Mark unread messages as read
    await ChatMessage.update(
      { readAt: new Date() },
      {
        where: {
          chatRoomId: roomId,
          senderType: senderType === 'service_provider' ? 'user' : 'service_provider',
          readAt: null
        }
      }
    );
    
    res.status(200).json({
      messages: messages.reverse(), // Reverse to get oldest first for chat display
      page,
      limit
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

// POST /api/service-provider/chat/rooms/:roomId/messages - Send a message in a chat room
router.post('/rooms/:roomId/messages', authenticateJWT, checkChatAccess, async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const { message, attachmentUrl } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    if (!message && !attachmentUrl) {
      return res.status(400).json({ error: 'Message or attachment is required' });
    }
    
    // Determine the type of the sender based on the user's role
    const senderType = userRole === 'service_provider' ? 'service_provider' : 'user';
    
    // Create a new message
    const chatMessage = await ChatMessage.create({
      chatRoomId: roomId,
      senderId: userId,
      senderType,
      message: message || '',
      attachmentUrl
    });
    
    // Update the lastMessageAt timestamp of the chat room
    await req.chatRoom.update({ lastMessageAt: new Date() });
    
    res.status(201).json({
      message: 'Message sent successfully',
      chatMessage
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Error sending message' });
  }
});

// PUT /api/service-provider/chat/rooms/:roomId/archive - Archive a chat room
router.put('/rooms/:roomId/archive', authenticateJWT, checkChatAccess, async (req, res) => {
  try {
    await req.chatRoom.update({ status: 'archived' });
    
    res.status(200).json({
      message: 'Chat room archived successfully',
      chatRoom: req.chatRoom
    });
  } catch (error) {
    console.error('Error archiving chat room:', error);
    res.status(500).json({ error: 'Error archiving chat room' });
  }
});

// PUT /api/service-provider/chat/rooms/:roomId/restore - Restore an archived chat room
router.put('/rooms/:roomId/restore', authenticateJWT, checkChatAccess, async (req, res) => {
  try {
    await req.chatRoom.update({ status: 'active' });
    
    res.status(200).json({
      message: 'Chat room restored successfully',
      chatRoom: req.chatRoom
    });
  } catch (error) {
    console.error('Error restoring chat room:', error);
    res.status(500).json({ error: 'Error restoring chat room' });
  }
});

module.exports = router;
