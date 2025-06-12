// Chat Models for Service Provider Service
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  // Chat Room Model
  const ChatRoom = sequelize.define('ChatRoom', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'The customer/user ID'
    },
    serviceProviderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'The service provider ID'
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    status: {
      type: DataTypes.ENUM('active', 'archived'),
      defaultValue: 'active'
    }
  });

  // Chat Message Model
  const ChatMessage = sequelize.define('ChatMessage', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    chatRoomId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    senderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'User ID of the sender'
    },
    senderType: {
      type: DataTypes.ENUM('user', 'service_provider'),
      allowNull: false,
      comment: 'Type of the sender: user or service_provider'
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    attachmentUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  });

  // Set up associations
  ChatRoom.hasMany(ChatMessage, { foreignKey: 'chatRoomId', as: 'messages' });
  ChatMessage.belongsTo(ChatRoom, { foreignKey: 'chatRoomId' });

  return {
    ChatRoom,
    ChatMessage
  };
};
