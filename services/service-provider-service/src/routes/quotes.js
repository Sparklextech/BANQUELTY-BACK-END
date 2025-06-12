const express = require('express');
const router = express.Router();
const { QuoteRequest, Quote, QuoteItem, Invoice, InvoiceItem, ServiceOrder } = require('../models');
const { authenticateJWT, authorizeRole } = require('../middleware/auth');

// Middleware to check if user has access to a specific quote
const checkQuoteAccess = async (req, res, next) => {
  try {
    const quoteId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const quote = await Quote.findByPk(quoteId);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Service providers can access their own quotes
    if (userRole === 'service_provider' && quote.serviceProviderId === userId) {
      req.quote = quote;
      return next();
    }
    
    // Users can access quotes directed to them
    if (userRole === 'user' && quote.userId === userId) {
      req.quote = quote;
      return next();
    }
    
    // Admin can access all quotes
    if (userRole === 'admin') {
      req.quote = quote;
      return next();
    }
    
    return res.status(403).json({ error: 'You do not have permission to access this quote' });
  } catch (error) {
    return res.status(500).json({ error: 'Error checking quote access' });
  }
};

// GET /api/service-provider/quotes - Get all quotes for the authenticated service provider
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let quotes;
    
    if (userRole === 'service_provider') {
      // Service provider sees quotes they created
      quotes = await Quote.findAll({
        where: { serviceProviderId: userId },
        include: [{ model: QuoteItem, as: 'items' }],
        order: [['createdAt', 'DESC']]
      });
    } else if (userRole === 'user') {
      // Regular user sees quotes they received
      quotes = await Quote.findAll({
        where: { userId: userId },
        include: [{ model: QuoteItem, as: 'items' }],
        order: [['createdAt', 'DESC']]
      });
    } else if (userRole === 'admin') {
      // Admin sees all quotes
      quotes = await Quote.findAll({
        include: [{ model: QuoteItem, as: 'items' }],
        order: [['createdAt', 'DESC']]
      });
    } else {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    
    res.status(200).json(quotes);
  } catch (error) {
    console.error('Error fetching quotes:', error);
    res.status(500).json({ error: 'Error fetching quotes' });
  }
});

// POST /api/service-provider/quotes - Create a new quote
router.post('/', authenticateJWT, authorizeRole(['service_provider']), async (req, res) => {
  try {
    const { 
      userId, customerName, customerEmail, serviceDate, 
      totalAmount, note, status, validUntil, items 
    } = req.body;
    
    if (!userId || !customerName || !customerEmail || !serviceDate || !totalAmount || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Use a transaction to ensure all operations complete or none do
    const result = await sequelize.transaction(async (t) => {
      // Create the quote
      const quote = await Quote.create({
        serviceProviderId: req.user.id,
        userId,
        customerName,
        customerEmail,
        serviceDate,
        totalAmount,
        note,
        status: status || 'draft',
        validUntil: validUntil || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // Default 14 days validity
      }, { transaction: t });
      
      // Create all the quote items
      const quoteItems = await Promise.all(
        items.map(item => QuoteItem.create({
          quoteId: quote.id,
          itemName: item.itemName,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice
        }, { transaction: t }))
      );
      
      return { quote, quoteItems };
    });
    
    res.status(201).json({
      message: 'Quote created successfully',
      quote: result.quote,
      items: result.quoteItems
    });
  } catch (error) {
    console.error('Error creating quote:', error);
    res.status(500).json({ error: 'Error creating quote' });
  }
});

// GET /api/service-provider/quotes/:id - Get a specific quote
router.get('/:id', authenticateJWT, checkQuoteAccess, async (req, res) => {
  try {
    const quote = await Quote.findByPk(req.params.id, {
      include: [{ model: QuoteItem, as: 'items' }]
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // If a user is viewing the quote, update its status to 'viewed' if it was 'sent'
    if (req.user.role === 'user' && quote.status === 'sent') {
      await quote.update({ status: 'viewed' });
    }
    
    res.status(200).json(quote);
  } catch (error) {
    console.error('Error fetching quote:', error);
    res.status(500).json({ error: 'Error fetching quote' });
  }
});

// PUT /api/service-provider/quotes/:id - Update a quote
router.put('/:id', authenticateJWT, checkQuoteAccess, async (req, res) => {
  try {
    const quote = req.quote;
    
    // Only allow updating quotes that are in draft status or by admin
    if (quote.status !== 'draft' && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Cannot update quote that is not in draft status' });
    }
    
    const {
      customerName, customerEmail, serviceDate,
      totalAmount, note, status, validUntil, items
    } = req.body;
    
    // Update the quote
    await quote.update({
      customerName: customerName || quote.customerName,
      customerEmail: customerEmail || quote.customerEmail,
      serviceDate: serviceDate || quote.serviceDate,
      totalAmount: totalAmount || quote.totalAmount,
      note: note !== undefined ? note : quote.note,
      status: status || quote.status,
      validUntil: validUntil || quote.validUntil
    });
    
    // If items are provided, update them
    if (items && Array.isArray(items)) {
      // Delete existing items
      await QuoteItem.destroy({ where: { quoteId: quote.id } });
      
      // Create new items
      await Promise.all(
        items.map(item => QuoteItem.create({
          quoteId: quote.id,
          itemName: item.itemName,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice
        }))
      );
    }
    
    // Fetch the updated quote with items
    const updatedQuote = await Quote.findByPk(quote.id, {
      include: [{ model: QuoteItem, as: 'items' }]
    });
    
    res.status(200).json({
      message: 'Quote updated successfully',
      quote: updatedQuote
    });
  } catch (error) {
    console.error('Error updating quote:', error);
    res.status(500).json({ error: 'Error updating quote' });
  }
});

// POST /api/service-provider/quotes/:id/accept - Accept a quote (for users)
router.post('/:id/accept', authenticateJWT, authorizeRole(['user']), async (req, res) => {
  try {
    const quoteId = req.params.id;
    const userId = req.user.id;
    
    const quote = await Quote.findByPk(quoteId);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Ensure the quote is directed to this user
    if (quote.userId !== userId) {
      return res.status(403).json({ error: 'You are not authorized to accept this quote' });
    }
    
    // Check if the quote can be accepted (not expired, rejected, or already accepted)
    if (quote.status !== 'sent' && quote.status !== 'viewed') {
      return res.status(400).json({
        error: `Cannot accept quote with status: ${quote.status}`
      });
    }
    
    // Check if the quote is expired
    if (new Date(quote.validUntil) < new Date()) {
      await quote.update({ status: 'expired' });
      return res.status(400).json({ error: 'This quote has expired' });
    }
    
    // Accept the quote
    await quote.update({ status: 'accepted' });
    
    res.status(200).json({
      message: 'Quote accepted successfully',
      quote: await Quote.findByPk(quoteId, {
        include: [{ model: QuoteItem, as: 'items' }]
      })
    });
  } catch (error) {
    console.error('Error accepting quote:', error);
    res.status(500).json({ error: 'Error accepting quote' });
  }
});

// POST /api/service-provider/quotes/:id/reject - Reject a quote (for users)
router.post('/:id/reject', authenticateJWT, authorizeRole(['user']), async (req, res) => {
  try {
    const quoteId = req.params.id;
    const userId = req.user.id;
    
    const quote = await Quote.findByPk(quoteId);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Ensure the quote is directed to this user
    if (quote.userId !== userId) {
      return res.status(403).json({ error: 'You are not authorized to reject this quote' });
    }
    
    // Check if the quote can be rejected
    if (quote.status !== 'sent' && quote.status !== 'viewed') {
      return res.status(400).json({
        error: `Cannot reject quote with status: ${quote.status}`
      });
    }
    
    // Reject the quote
    await quote.update({ status: 'rejected' });
    
    res.status(200).json({
      message: 'Quote rejected successfully',
      quote: await Quote.findByPk(quoteId, {
        include: [{ model: QuoteItem, as: 'items' }]
      })
    });
  } catch (error) {
    console.error('Error rejecting quote:', error);
    res.status(500).json({ error: 'Error rejecting quote' });
  }
});

// POST /api/service-provider/quotes/:id/invoice - Create an invoice from a quote
router.post('/:id/invoice', authenticateJWT, authorizeRole(['service_provider']), async (req, res) => {
  try {
    const quoteId = req.params.id;
    const serviceProviderId = req.user.id;
    
    const quote = await Quote.findByPk(quoteId, {
      include: [{ model: QuoteItem, as: 'items' }]
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Ensure the quote belongs to this service provider
    if (quote.serviceProviderId !== serviceProviderId) {
      return res.status(403).json({ error: 'You are not authorized to create an invoice for this quote' });
    }
    
    // Check if the quote is accepted
    if (quote.status !== 'accepted') {
      return res.status(400).json({
        error: `Cannot create invoice for quote with status: ${quote.status}`
      });
    }
    
    // Use a transaction to ensure all operations complete or none do
    const result = await sequelize.transaction(async (t) => {
      // Create the invoice
      const invoice = await Invoice.create({
        quoteId: quote.id,
        serviceProviderId: quote.serviceProviderId,
        userId: quote.userId,
        customerName: quote.customerName,
        customerEmail: quote.customerEmail,
        serviceDate: quote.serviceDate,
        totalAmount: quote.totalAmount,
        status: 'pending',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days to pay
        paymentLink: `/payment/${quote.id}` // This would be replaced with a real Stripe payment link
      }, { transaction: t });
      
      // Create the invoice items based on quote items
      const invoiceItems = await Promise.all(
        quote.items.map(item => InvoiceItem.create({
          invoiceId: invoice.id,
          itemName: item.itemName,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice
        }, { transaction: t }))
      );
      
      // Update the quote status to invoiced
      await quote.update({ status: 'invoiced' }, { transaction: t });
      
      return { invoice, invoiceItems };
    });
    
    res.status(201).json({
      message: 'Invoice created successfully',
      invoice: result.invoice,
      items: result.invoiceItems
    });
  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({ error: 'Error creating invoice' });
  }
});

// POST /api/service-provider/quotes/:id/send - Send a quote to the customer
router.post('/:id/send', authenticateJWT, authorizeRole(['service_provider']), async (req, res) => {
  try {
    const quoteId = req.params.id;
    const serviceProviderId = req.user.id;
    
    const quote = await Quote.findByPk(quoteId);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Ensure the quote belongs to this service provider
    if (quote.serviceProviderId !== serviceProviderId) {
      return res.status(403).json({ error: 'You are not authorized to send this quote' });
    }
    
    // Check if the quote is in draft status
    if (quote.status !== 'draft') {
      return res.status(400).json({
        error: `Cannot send quote with status: ${quote.status}`
      });
    }
    
    // Update the quote status to sent
    await quote.update({ status: 'sent' });
    
    // In a real implementation, this would also send an email to the customer
    
    res.status(200).json({
      message: 'Quote sent successfully',
      quote: await Quote.findByPk(quoteId, {
        include: [{ model: QuoteItem, as: 'items' }]
      })
    });
  } catch (error) {
    console.error('Error sending quote:', error);
    res.status(500).json({ error: 'Error sending quote' });
  }
});

module.exports = router;
