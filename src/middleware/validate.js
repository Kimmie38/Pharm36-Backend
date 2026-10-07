// validate({ body, query, params }) -> parsed values land on req.valid.{body,query,params}
// (Express 5 makes req.query read-only, so we never overwrite req.*)
module.exports = (schemas) => (req, _res, next) => {
  try {
    req.valid = req.valid || {};
    for (const key of ['params', 'query', 'body']) {
      if (schemas[key]) req.valid[key] = schemas[key].parse(req[key] ?? {});
    }
    next();
  } catch (e) {
    next(e);
  }
};
