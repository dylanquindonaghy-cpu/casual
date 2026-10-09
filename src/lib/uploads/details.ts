import { uploads } from "../db/schema";

// An upload's details without its image (docs/office-v2.md 5.5; 12F.2): what the casual's and the
// firm's JSON exports carry (kind, type, date, status, the check, the sha256 fingerprint). The bytes
// would turn into arrays of numbers several times their size inside one JSON file built in memory;
// each image is its own download instead (`/files/{id}?download=1`, from the data pages).
export const uploadDetails = () => ({
  id: uploads.id,
  kind: uploads.kind,
  credentialType: uploads.credentialType,
  contentType: uploads.contentType,
  size: uploads.size,
  sha256: uploads.sha256,
  uploadedBy: uploads.uploadedBy,
  status: uploads.status,
  checkedBy: uploads.checkedBy,
  checkedAt: uploads.checkedAt,
  rejectReason: uploads.rejectReason,
  createdAt: uploads.createdAt,
});
