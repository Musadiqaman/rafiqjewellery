import test from 'node:test';
import assert from 'node:assert/strict';
import * as models from '../models/index.js';
import { Purchase } from '../models/Purchase.js';

test('model indexes never attempt to replace the built-in MongoDB _id index', () => {
  for (const model of Object.values(models)) {
    for (const [fields] of model.schema.indexes()) {
      assert.ok(
        !(Object.keys(fields).length === 1 && Object.hasOwn(fields, '_id')),
        `${model.modelName} must use MongoDB's existing _id index`,
      );
    }
  }
});

test('purchase model has a compound phone/date index for phone-prefix search', () => {
  const hasPhoneIndex = Purchase.schema.indexes().some(([fields]) =>
    fields['customer.phone'] === 1 && fields.purchasedAt === -1 && fields._id === -1,
  );
  assert.ok(hasPhoneIndex, 'Phone-prefix search should use a phone/date index');
});
