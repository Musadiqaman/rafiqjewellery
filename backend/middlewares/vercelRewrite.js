
/**
 * Remove Vercel's internal wildcard rewrite parameter
 * before strict API query validation.
 */
export function stripVercelRewritePath(req, _res, next) {
  // Remove path from request URL
  const url = new URL(req.url, 'http://vercel.internal');

  if (url.searchParams.has('path')) {
    url.searchParams.delete('path');
    req.url = url.pathname + url.search;
  }

  // Remove path from Express query parameters
  const query = req.query;

  if (query && Object.prototype.hasOwnProperty.call(query, 'path')) {
    const cleanQuery = { ...query };
    delete cleanQuery.path;

    Object.defineProperty(req, 'query', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: cleanQuery,
    });
  }

  next();
}
