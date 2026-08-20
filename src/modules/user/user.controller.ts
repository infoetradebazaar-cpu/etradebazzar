import { Request, Response } from "express";
import { userService } from "./user.service";
import { logger } from "../../utils/logger";

export const userController = {
  async listUsers(req: Request, res: Response) {
    try {
      const { search, status, page, limit } = req.query as Record<string, string>;
      const result = await userService.listUsers({
        search: search || undefined,
        status: status || undefined,
        page: page ? parseInt(page) : undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List users failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getUserById(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const result = await userService.getUserById(userId);
      if (!result)
        return res.status(404).json({ success: false, error: "User not found" });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get user failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
};
