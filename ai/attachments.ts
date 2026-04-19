import { fileExists, fullPathForFile } from "@/lib/files"
import { generateFilePreviews } from "@/lib/previews/generate"
import { File, User } from "@/prisma/client"
import fs from "fs/promises"
import sharp from "sharp"

const MAX_PAGES_TO_ANALYZE = 4

export type AnalyzeAttachment = {
  filename: string
  contentType: string
  base64: string
}

export const loadAttachmentsForAI = async (user: User, file: File): Promise<AnalyzeAttachment[]> => {
  const fullFilePath = fullPathForFile(user, file)
  const isFileExists = await fileExists(fullFilePath)
  if (!isFileExists) {
    throw new Error("File not found on disk")
  }

  const { contentType, previews } = await generateFilePreviews(user, fullFilePath, file.mimetype)

  return Promise.all(
    previews.slice(0, MAX_PAGES_TO_ANALYZE).map(async (preview) => {
      const normalizedAttachment = await loadFileAsAiAttachment(preview, contentType)

      return {
        filename: file.filename,
        contentType: normalizedAttachment.contentType,
        base64: normalizedAttachment.base64,
      }
    })
  )
}

export const loadFileAsBase64 = async (filePath: string): Promise<string> => {
  const buffer = await fs.readFile(filePath)
  return Buffer.from(buffer).toString("base64")
}

export const loadFileAsAiAttachment = async (
  filePath: string,
  contentType: string
): Promise<{ contentType: string; base64: string }> => {
  if (!contentType.startsWith("image/")) {
    return {
      contentType,
      base64: await loadFileAsBase64(filePath),
    }
  }

  try {
    const buffer = await sharp(filePath)
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColorspace("srgb")
      .jpeg({ quality: 92 })
      .toBuffer()

    return {
      contentType: "image/jpeg",
      base64: Buffer.from(buffer).toString("base64"),
    }
  } catch {
    return {
      contentType,
      base64: await loadFileAsBase64(filePath),
    }
  }
}
