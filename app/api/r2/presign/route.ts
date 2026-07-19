import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextRequest, NextResponse } from 'next/server';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filename    = searchParams.get('filename');
  const contentType = searchParams.get('type');

  if (!filename || !contentType) {
    return NextResponse.json({ error: 'Missing filename or type' }, { status: 400 });
  }

  const key = `chat-videos/${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;

  const url = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket:      process.env.R2_BUCKET_NAME!,
      Key:         key,
      ContentType: contentType,
    }),
    { expiresIn: 3600 },
  );

  const publicUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${key}`;

  return NextResponse.json({ uploadUrl: url, publicUrl });
}
