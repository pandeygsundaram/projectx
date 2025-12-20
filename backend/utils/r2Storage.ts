import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config'

// Initialize R2 client (S3-compatible)
if (!process.env.R2_ENDPOINT) {
  throw new Error('R2_ENDPOINT is not configured in environment variables');
}

console.log(`🔧 Configuring R2 client with endpoint: ${process.env.R2_ENDPOINT}`);
console.log(`🔧 R2 Access Key: ${process.env.R2_ACCESS_KEY_ID?.substring(0, 8)}...`);
console.log(`🔧 R2 Bucket: ${process.env.R2_BUCKET_NAME}`);

const r2Client = new S3Client({
  region: 'auto',
  endpoint: {
    url: new URL(process.env.R2_ENDPOINT),
  },
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
  },
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'hitbox-storage';
const R2_FOLDER = 'project-snapshots'; // Folder inside the bucket

export interface UploadResult {
  key: string;
}

/**
 * Upload file to R2 storage
 */
export async function uploadToR2(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  projectId: string
): Promise<UploadResult> {
  try {
    // Generate unique key for the file with project-snapshots folder prefix
    const fileExtension = fileName.split('.').pop();
    const uniqueKey = `${R2_FOLDER}/${projectId}/${uuidv4()}.${fileExtension}`;

    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: uniqueKey,
      Body: buffer,
      ContentType: mimeType,
      Metadata: {
        originalFileName: fileName,
        projectId: projectId,
        uploadedAt: new Date().toISOString()
      }
    });

    await r2Client.send(command);

    console.log(`✅ Uploaded to R2: ${BUCKET_NAME}/${uniqueKey}`);

    return {
      key: uniqueKey
    };
  } catch (error: any) {
    console.error('R2 upload error:', error);
    throw new Error(`Failed to upload file to R2: ${error.message}`);
  }
}

/**
 * Download file from R2 storage
 */
export async function downloadFromR2(key: string): Promise<Buffer> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    });

    const response = await r2Client.send(command);

    if (!response.Body) {
      throw new Error('No file content returned');
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  } catch (error: any) {
    console.error('R2 download error:', error);
    throw new Error(`Failed to download file from R2: ${error.message}`);
  }
}

/**
 * Delete file from R2 storage
 */
export async function deleteFromR2(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    });

    await r2Client.send(command);
  } catch (error: any) {
    console.error('R2 delete error:', error);
    throw new Error(`Failed to delete file from R2: ${error.message}`);
  }
}

/**
 * Generate a temporary signed URL for accessing a private R2 file
 * @param key - The R2 object key
 * @param expiresIn - Expiration time in seconds (default: 1 hour)
 */
export async function generateSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    });

    // Generate signed URL that expires in the specified time
    const signedUrl = await getSignedUrl(r2Client, command, { expiresIn });

    return signedUrl;
  } catch (error: any) {
    console.error('Error generating signed URL:', error);
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }
}

/**
 * Generate signed URLs for multiple snapshots
 */
export async function generateSignedUrlsForSnapshots(
  snapshots: Array<{ s3Key: string; [key: string]: any }>,
  expiresIn: number = 3600
): Promise<Array<{ signedUrl: string; [key: string]: any }>> {
  try {
    const snapshotsWithUrls = await Promise.all(
      snapshots.map(async (snapshot) => ({
        ...snapshot,
        signedUrl: await generateSignedUrl(snapshot.s3Key, expiresIn)
      }))
    );

    return snapshotsWithUrls;
  } catch (error: any) {
    console.error('Error generating signed URLs for snapshots:', error);
    throw error;
  }
}

/**
 * Validate R2 configuration
 */
export function validateR2Config(): boolean {
  const required = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];

  for (const key of required) {
    if (!process.env[key]) {
      console.warn(`⚠️  Missing R2 configuration: ${key}`);
      return false;
    }
  }

  return true;
}

// ========== DEPLOYMENT OPERATIONS ==========

export interface DeploymentFile {
  path: string;
  content: Buffer;
  mimeType: string;
}

export interface DeploymentResult {
  deploymentUrl: string;
  filesUploaded: number;
}

/**
 * Upload built project files to R2 for production deployment
 * Creates a public deployment that can be accessed via URL
 */
export async function uploadDeployment(
  projectId: string,
  files: DeploymentFile[]
): Promise<DeploymentResult> {
  try {
    console.log(`🚀 Uploading deployment for project ${projectId} (${files.length} files)...`);

    // Upload to deployments/{projectId}/dist/ to preserve build structure
    const deploymentFolder = `deployments/${projectId}/dist`;
    const uploadPromises = files.map(async (file) => {
      const key = `${deploymentFolder}/${file.path}`;

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: file.content,
        ContentType: file.mimeType,
        // Make files publicly readable
        // Note: You need to configure your R2 bucket to allow public access
        Metadata: {
          projectId: projectId,
          deployedAt: new Date().toISOString(),
        },
      });

      await r2Client.send(command);
      console.log(`  ✅ Uploaded: ${file.path}`);
    });

    await Promise.all(uploadPromises);

    console.log(`✅ Deployment complete for ${projectId}`);

    // Return the deployment URL
    const deploymentUrl = getDeploymentUrl(projectId);

    return {
      deploymentUrl,
      filesUploaded: files.length,
    };
  } catch (error: any) {
    console.error('Deployment upload error:', error);
    throw new Error(`Failed to upload deployment: ${error.message}`);
  }
}

/**
 * Get the public URL for a deployed project
 * You can customize this based on your R2 bucket configuration
 */
export function getDeploymentUrl(projectId: string): string {
  // Use R2 public bucket URL - point to dist/index.html
  const r2PublicUrl = process.env.R2_PUBLIC_URL || 'https://pub-18b55177615f46d3a53f3d84747d7f02.r2.dev';
  return `${r2PublicUrl}/deployments/${projectId}/dist/index.html`;
}

/**
 * Delete deployment files from R2
 */
export async function deleteDeployment(projectId: string): Promise<void> {
  try {
    // Note: This is a simplified version. In production, you'd want to:
    // 1. List all objects with prefix `deployments/${projectId}/`
    // 2. Delete them in batches
    // For now, we'll just log this operation
    console.log(`🗑️  Deployment deletion for ${projectId} would happen here`);

    // TODO: Implement batch deletion using ListObjectsV2 and DeleteObjects commands
  } catch (error: any) {
    console.error('Deployment deletion error:', error);
    throw new Error(`Failed to delete deployment: ${error.message}`);
  }
}
