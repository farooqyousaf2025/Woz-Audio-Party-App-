function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function toInt(value, fallback = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function publicUser(row) {
  if (!row) return null;
  return {
    objectId: row.object_id,
    username: row.username,
    email: row.email,
    name: row.name,
    role: row.role,
    avatarUrl: row.avatar_url,
    credit: row.credit,
    diamonds: row.diamonds,
    diamondsTotal: row.diamonds_total,
    pCoins: row.p_coins,
    activationStatus: row.activation_status,
    accountDeleted: row.account_deleted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.data || {}),
  };
}

module.exports = { asyncHandler, toInt, publicUser };
