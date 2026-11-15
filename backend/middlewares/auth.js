import { User } from '../models/index.js';
import { can } from '../validators/domain.js';
import { HttpError } from '../utils/http.js';
import { issueAccessToken, verifyAccessToken } from '../utils/accessToken.js';

export async function requireAuth(req, _res, next) {
  try {
    const authorization = req.get?.('authorization') || req.headers?.authorization || '';
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    const claims = match ? verifyAccessToken(match[1]) : null;
    if (!claims) throw new HttpError(401, 'Please sign in again.');

    const versionFilter =
      claims.ver === 0
        ? { $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }] }
        : { authVersion: claims.ver };
    const user = await User.findOne({
      _id: claims.sub,
      active: true,
      ...versionFilter,
    })
      .select('name email role active authVersion')
      .lean();

    if (!user) throw new HttpError(401, 'Account unavailable. Please sign in again.');
    req.user = user;
    req.auth = claims;
    next();
  } catch (error) {
    next(error);
  }
}

export const allow = (permission) => (req, _res, next) => {
  if (!req.user || !can(req.user.role, permission))
    return next(new HttpError(403, 'Your role does not allow this action'));
  next();
};

export function createAccessTokenResponse(user) {
  const { token, expiresAt } = issueAccessToken(user);
  return {
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
    },
    token,
    expiresAt,
  };
}
