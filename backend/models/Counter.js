import mongoose, { Schema } from 'mongoose';
export const Counter = mongoose.model('Counter', new Schema({ _id: String, value: Number }));
