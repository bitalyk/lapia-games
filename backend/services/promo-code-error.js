export default class PromoCodeError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'PromoCodeError';
    this.statusCode = options.statusCode || 400;
    this.reason = options.reason || 'promo_error';
  }
}
