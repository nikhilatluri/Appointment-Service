/**
 * Mask PII (Personally Identifiable Information) in logs
 */

const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return email;
  const [username, domain] = email.split('@');
  if (!username || !domain) return email;
  const maskedUsername = username.length > 2
    ? username[0] + '*'.repeat(username.length - 2) + username[username.length - 1]
    : username[0] + '*';
  return `${maskedUsername}@${domain}`;
};

const maskPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return phone;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 4) return '****';
  return '******' + cleaned.slice(-4);
};

const maskPII = (data) => {
  if (!data || typeof data !== 'object') return data;

  const masked = Array.isArray(data) ? [...data] : { ...data };

  const processValue = (obj) => {
    if (Array.isArray(obj)) {
      return obj.map(item => processValue(item));
    }

    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'email' && typeof value === 'string') {
          result[key] = maskEmail(value);
        } else if (key === 'phone' && typeof value === 'string') {
          result[key] = maskPhone(value);
        } else if (key === 'password' || key === 'token') {
          result[key] = '***REDACTED***';
        } else if (typeof value === 'object') {
          result[key] = processValue(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }

    return obj;
  };

  return processValue(masked);
};

module.exports = { maskEmail, maskPhone, maskPII };
