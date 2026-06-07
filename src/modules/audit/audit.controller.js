import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { auditService } from "./audit.service.js";

const getAuditLogs = asyncHandler(async (req, res) => {
  const result = await auditService.getAuditLogs(req.validatedData.query);

  return sendResponse(res, 200, "Audit logs fetched successfully.", result);
});

const getAuditLogById = asyncHandler(async (req, res) => {
  const result = await auditService.getAuditLogById(req.params.auditLogId);

  return sendResponse(res, 200, "Audit log fetched successfully.", result);
});

export const auditController = {
  getAuditLogs,
  getAuditLogById,
};
