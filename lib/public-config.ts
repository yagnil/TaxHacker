const publicConfig = {
  app: {
    title: "TaxHacker",
    description: "Your personal AI accountant",
    supportEmail: "me@vas3k.com",
  },
  upload: {
    acceptedMimeTypes: "image/*,.pdf,.doc,.docx,.xls,.xlsx",
    images: {
      maxWidth: 1800,
      maxHeight: 1800,
      quality: 90,
    },
    pdfs: {
      maxPages: 10,
      dpi: 150,
      quality: 90,
      maxWidth: 1500,
      maxHeight: 1500,
    },
  },
} as const

export default publicConfig