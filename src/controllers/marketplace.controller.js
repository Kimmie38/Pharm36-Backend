const Listing = require('../models/Listing');
const Batch = require('../models/Batch');
const SaleRecord = require('../models/SaleRecord');
const MarketplaceOrder = require('../models/MarketplaceOrder');
const AppError = require('../utils/AppError');
const { escapeRegex } = require('../utils/regex');
const { canAddCategory } = require('../constants/permissions');
const { getCategory, sectionLabel } = require('../constants/professions');
const { todayUTC } = require('../utils/dates');
const { sellerLabel } = require('../services/serializers');

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const SELLER_FIELDS = 'name storeName location state phone pcnStatus';

function present(listing, viewerId) {
  const j = listing.toJSON();
  const s = listing.seller && listing.seller._id ? listing.seller : null;
  j.seller = s ? { id: String(s._id), name: sellerLabel(s), location: s.location, phone: s.phone } : { id: String(listing.seller) };
  j.mine = String(s ? s._id : listing.seller) === String(viewerId);
  return j;
}

// GET /api/marketplace/listings?type=offer|request&search=&mine=
async function browse(req, res) {
  const { type, search, mine, status, page, limit } = req.valid.query;
  const filter = { type };
  if (mine) {
    filter.seller = req.user._id;
    if (status) filter.status = status;
  } else {
    filter.status = 'open';
    filter.seller = { $ne: req.user._id };
    if (type === 'offer') filter.expiryDate = { $gte: todayUTC() }; // expired stock is never shown
  }
  if (search) filter.drugName = { $regex: escapeRegex(search), $options: 'i' };

  const [items, total] = await Promise.all([
    Listing.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('seller', SELLER_FIELDS),
    Listing.countDocuments(filter),
  ]);
  // hide listings from sellers whose access was revoked
  const visible = mine ? items : items.filter((l) => l.seller && l.seller.pcnStatus === 'active');
  res.json({ items: visible.map((l) => present(l, req.user._id)), total, page, limit });
}

// POST /api/marketplace/listings { batchId, quantity?, unitPrice?, note? }
async function createOffer(req, res) {
  const b = req.valid.body;
  const batch = await Batch.findOne({ _id: b.batchId, owner: req.user._id });
  if (!batch) throw new AppError(404, 'Batch not found');
  if (batch.state !== 'active') throw new AppError(409, `This batch is already ${batch.state}`);
  if (batch.expiryDate < todayUTC()) throw new AppError(409, 'Expired drugs cannot be listed. Dispose of this batch instead.', { code: 'EXPIRED_BATCH' });

  const quantity = b.quantity ?? batch.quantity;
  if (quantity < 1 || quantity > batch.quantity) throw new AppError(400, `Quantity must be between 1 and ${batch.quantity}`);
  if (await Listing.exists({ batch: batch._id, status: 'open', type: 'offer' })) {
    throw new AppError(409, 'This batch already has an open listing. Edit or cancel it first.');
  }

  const listing = await Listing.create({
    type: 'offer', seller: req.user._id, batch: batch._id,
    drugName: batch.drugName, category: batch.category, quantity, unitPrice: b.unitPrice ?? batch.unitPrice, note: b.note,
    batchCode: batch.batchCode, manufacturer: batch.manufacturer, strength: batch.strength, form: batch.form,
    manufactureDate: batch.manufactureDate, expiryDate: batch.expiryDate,
  });
  await listing.populate('seller', SELLER_FIELDS);
  res.status(201).json({ listing: present(listing, req.user._id) });
}

// POST /api/marketplace/requests { drugName, quantity, maxUnitPrice, category?, note? }
async function createRequest(req, res) {
  const b = req.valid.body;
  const listing = await Listing.create({
    type: 'request', seller: req.user._id, drugName: b.drugName, category: b.category,
    quantity: b.quantity, unitPrice: b.maxUnitPrice, note: b.note,
  });
  await listing.populate('seller', SELLER_FIELDS);
  res.status(201).json({ listing: present(listing, req.user._id) });
}

async function ownListing(req) {
  const l = await Listing.findOne({ _id: req.valid.params.id, seller: req.user._id });
  if (!l) throw new AppError(404, 'Listing not found');
  if (l.status !== 'open') throw new AppError(409, `This listing is already ${l.status}`);
  return l;
}

async function updateListing(req, res) {
  const l = await ownListing(req);
  const b = req.valid.body;
  if (b.quantity !== undefined) {
    if (l.type === 'offer') {
      const batch = await Batch.findById(l.batch);
      if (!batch || batch.state !== 'active' || b.quantity > batch.quantity) {
        throw new AppError(400, `Quantity can't exceed the ${batch ? batch.quantity : 0} unit(s) you have in stock`);
      }
    }
    l.quantity = b.quantity;
  }
  if (b.unitPrice !== undefined) l.unitPrice = b.unitPrice;
  if (b.note !== undefined) l.note = b.note;
  await l.save();
  await l.populate('seller', SELLER_FIELDS);
  res.json({ listing: present(l, req.user._id) });
}

async function cancelListing(req, res) {
  const l = await ownListing(req);
  l.status = 'cancelled';
  await l.save();
  res.json({ listing: l });
}

// POST /api/marketplace/listings/:id/buy { quantity? }  (default: the whole listing)
async function buy(req, res) {
  const listing = await Listing.findOne({ _id: req.valid.params.id, type: 'offer', status: 'open' }).populate('seller', SELLER_FIELDS);
  if (!listing) throw new AppError(404, 'This listing is no longer available');
  if (String(listing.seller._id) === String(req.user._id)) throw new AppError(400, "You can't buy your own listing");
  if (listing.seller.pcnStatus !== 'active') throw new AppError(409, 'This seller is no longer active on Pharm36');
  if (listing.expiryDate < todayUTC()) throw new AppError(409, 'This batch has expired and can no longer be bought', { code: 'EXPIRED_BATCH' });

  if (!canAddCategory(req.user, listing.category)) {
    const cat = getCategory(listing.category);
    throw new AppError(403, `Your account isn't registered to stock "${cat.label}" (needs ${cat.requiredSections.map(sectionLabel).join(' or ')}).`, {
      code: 'CATEGORY_RESTRICTED', category: listing.category,
    });
  }

  const qty = req.valid.body.quantity ?? listing.quantity;
  if (qty < 1 || qty > listing.quantity) throw new AppError(400, `Quantity must be between 1 and ${listing.quantity}`);

  // 1) take the units out of the seller's real stock (atomic, can't oversell)
  const sellerBatch = await Batch.findOneAndUpdate(
    { _id: listing.batch, owner: listing.seller._id, state: 'active', quantity: { $gte: qty }, expiryDate: { $gte: todayUTC() } },
    { $inc: { quantity: -qty } },
    { returnDocument: 'after' }
  );
  if (!sellerBatch) {
    await Listing.updateOne({ _id: listing._id, status: 'open' }, { status: 'cancelled' });
    throw new AppError(409, 'The seller no longer has enough stock of this batch');
  }
  // 2) take the units out of the listing (atomic); undo step 1 if someone beat us to it
  const updatedListing = await Listing.findOneAndUpdate(
    { _id: listing._id, status: 'open', quantity: { $gte: qty } },
    { $inc: { quantity: -qty } },
    { returnDocument: 'after' }
  );
  if (!updatedListing) {
    await Batch.updateOne({ _id: sellerBatch._id }, { $inc: { quantity: qty } });
    throw new AppError(409, 'Someone else just bought this listing');
  }
  if (updatedListing.quantity === 0) {
    updatedListing.status = 'fulfilled';
    await updatedListing.save();
  }
  if (sellerBatch.quantity === 0) {
    sellerBatch.state = 'sold';
    sellerBatch.closedAt = new Date();
    await sellerBatch.save();
    await Listing.updateMany({ batch: sellerBatch._id, status: 'open' }, { status: 'cancelled' });
  }

  // 3) records: seller's sale, order audit trail, and the buyer's new inventory
  const total = qty * listing.unitPrice;
  await SaleRecord.create({
    owner: listing.seller._id, batch: sellerBatch._id, drugName: listing.drugName, batchCode: listing.batchCode,
    quantity: qty, unitPrice: listing.unitPrice, revenue: total, channel: 'marketplace',
  });
  const order = await MarketplaceOrder.create({
    listing: listing._id, seller: listing.seller._id, buyer: req.user._id,
    drugName: listing.drugName, batchCode: listing.batchCode, quantity: qty, unitPrice: listing.unitPrice, total,
  });
  const buyerBatch = await Batch.findOneAndUpdate(
    { owner: req.user._id, batchCode: listing.batchCode, state: 'active' },
    {
      $inc: { quantity: qty },
      $setOnInsert: compact({
        drugName: listing.drugName, category: listing.category, manufacturer: listing.manufacturer,
        strength: listing.strength, form: listing.form, manufactureDate: listing.manufactureDate,
        expiryDate: listing.expiryDate, unitPrice: listing.unitPrice, source: 'marketplace',
        reminder: req.user.settings?.defaultReminder ?? null,
      }),
    },
    { upsert: true, returnDocument: 'after' }
  );

  res.status(201).json({ order, batch: buyerBatch });
}

// GET /api/marketplace/orders?role=buyer|seller
async function myOrders(req, res) {
  const { role, page, limit } = req.valid.query;
  const filter = role === 'seller' ? { seller: req.user._id } : { buyer: req.user._id };
  const [items, total] = await Promise.all([
    MarketplaceOrder.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('seller', 'name storeName state').populate('buyer', 'name storeName state'),
    MarketplaceOrder.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
}

module.exports = { browse, createOffer, createRequest, updateListing, cancelListing, buy, myOrders };
