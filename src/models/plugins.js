// Shared toJSON: _id -> id, drop __v, include virtuals.
module.exports = function jsonPlugin(schema, hide = []) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      delete ret.id_;
      hide.forEach((k) => delete ret[k]);
      return ret;
    },
  });
};
