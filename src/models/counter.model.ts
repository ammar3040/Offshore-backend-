import mongoose, { Model, Schema } from "mongoose";

interface CounterAttrs {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterAttrs>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

const CounterModel: Model<CounterAttrs> =
  (mongoose.models.Counter as Model<CounterAttrs> | undefined) ??
  mongoose.model<CounterAttrs>("Counter", counterSchema);

/** Atomically increment and return the next sequence value for `key`. */
export async function nextSequence(key: string): Promise<number> {
  const doc = await CounterModel.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  if (!doc || typeof doc.seq !== "number") {
    throw new Error(`Failed to allocate sequence for ${key}`);
  }
  return doc.seq;
}

/** Ensure counter is at least `minSeq` (never decreases). */
export async function ensureSequenceAtLeast(key: string, minSeq: number): Promise<void> {
  if (minSeq <= 0) return;
  await CounterModel.findByIdAndUpdate(
    key,
    { $max: { seq: minSeq } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}
