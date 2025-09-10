const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    console.log(' DEBUG: Auth Header:', authHeader ? 'Present' : 'Missing');
    console.log(' DEBUG: Token extracted:', token ? 'Yes' : 'No');

    if (!token) {
      console.log(' DEBUG: No token provided');
      return res.status(401).json({ 
        success: false,
        message: 'Access token required'
      });
    }

    // Debug JWT Secret
    console.log(' DEBUG: JWT_SECRET exists:', !!process.env.JWT_SECRET);
    console.log(' DEBUG: JWT_SECRET value:', process.env.JWT_SECRET);
    console.log(' DEBUG: JWT_SECRET length:', process.env.JWT_SECRET?.length);

    // Try to decode without verification first
    const decodedWithoutVerify = jwt.decode(token, { complete: true });
    console.log(' DEBUG: Token decoded (no verify):', JSON.stringify(decodedWithoutVerify, null, 2));

    // Now verify with secret
    console.log(' DEBUG: Attempting to verify token...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log(' DEBUG: Token verified successfully:', decoded);
    
    // Find user
    console.log(' DEBUG: Looking for user with ID:', decoded.userId);
    const user = await User.findByPk(decoded.userId);
    console.log(' DEBUG: User found:', user ? `Yes - ${user.email}` : 'No');
    
    if (user) {
      console.log(' DEBUG: User active:', user.isActive);
      console.log(' DEBUG: User role:', user.role);
    }

    if (!user || !user.isActive) {
      console.log(' DEBUG: User not found or inactive');
      return res.status(401).json({ 
        success: false,
        message: 'Invalid token - user not found or inactive'
      });
    }

    req.user = user;
    console.log(' DEBUG: Authentication successful');
    next();
  } catch (error) {
    console.log(' DEBUG: JWT Error type:', error.name);
    console.log(' DEBUG: JWT Error message:', error.message);
    console.log(' DEBUG: Full error:', error);
    
    return res.status(401).json({ 
      success: false,
      message: 'Invalid token',
      debug: {
        errorType: error.name,
        errorMessage: error.message
      }
    });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    res.status(403).json({ 
      success: false,
      message: 'Admin privileges required'
    });
  }
};

module.exports = {
  authenticateToken,
  isAdmin
};
