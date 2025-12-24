import { executeInPod } from './kubernetes';
import { uploadToR2, downloadFromR2 } from '../utils/r2Storage';
import prisma from '../config/database';

/**
 * Create a snapshot of a project
 * 1. Remove node_modules from the project
 * 2. Create a zip file
 * 3. Upload to R2
 * 4. Save snapshot record to database
 */
export async function createProjectSnapshot(projectId: string): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📸 [SNAPSHOT] Creating snapshot for project:', projectId);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Step 1: Remove node_modules to reduce snapshot size
    console.log('🗑️  [SNAPSHOT] Removing node_modules...');
    try {
      await executeInPod(projectId, 'rm -rf /app/node_modules');
      console.log('✅ [SNAPSHOT] node_modules removed');
    } catch (error: any) {
      console.log('⚠️  [SNAPSHOT] node_modules not found or already removed');
    }

    // Step 2: Create a zip file of the project
    console.log('📦 [SNAPSHOT] Creating zip archive...');
    const zipFileName = `snapshot-${Date.now()}.zip`;
    await executeInPod(
      projectId,
      `cd /app && zip -r /tmp/${zipFileName} . -x "node_modules/*" -x ".git/*" -x "dist/*" -x "build/*"`
    );
    console.log('✅ [SNAPSHOT] Zip archive created');

    // Step 3: Get the zip file content
    console.log('📥 [SNAPSHOT] Reading zip file...');
    const zipContent = await executeInPod(projectId, `cat /tmp/${zipFileName}`);
    const zipBuffer = Buffer.from(zipContent, 'binary');
    console.log(`✅ [SNAPSHOT] Zip file read (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // Step 4: Upload to R2
    console.log('☁️  [SNAPSHOT] Uploading to R2...');
    const uploadResult = await uploadToR2(
      zipBuffer,
      zipFileName,
      'application/zip',
      projectId
    );
    console.log('✅ [SNAPSHOT] Uploaded to R2:', uploadResult.key);

    // Step 5: Save snapshot record to database
    console.log('💾 [SNAPSHOT] Saving snapshot record to database...');
    const snapshot = await prisma.snapshot.create({
      data: {
        projectId,
        s3Key: uploadResult.key,
        snapshotType: 'full',
        sizeBytes: BigInt(zipBuffer.length),
      },
    });
    console.log('✅ [SNAPSHOT] Snapshot record saved:', snapshot.id);

    // Step 6: Cleanup temp file
    try {
      await executeInPod(projectId, `rm /tmp/${zipFileName}`);
    } catch (error) {
      // Ignore cleanup errors
    }

    console.log('✅ [SNAPSHOT] Snapshot created successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return snapshot.id;
  } catch (error: any) {
    console.error('❌ [SNAPSHOT] Error creating snapshot:', error);
    throw new Error(`Failed to create snapshot: ${error.message}`);
  }
}

/**
 * Restore a project from the latest snapshot
 * 1. Get the latest snapshot from database
 * 2. Download zip from R2
 * 3. Extract to pod
 * 4. Run npm install
 */
export async function restoreProjectSnapshot(projectId: string): Promise<boolean> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 [RESTORE] Restoring project from snapshot:', projectId);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Step 1: Get the latest snapshot
    console.log('🔍 [RESTORE] Looking for latest snapshot...');
    const snapshot = await prisma.snapshot.findFirst({
      where: {
        projectId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!snapshot) {
      console.log('⚠️  [RESTORE] No snapshot found for project');
      return false;
    }

    console.log('✅ [RESTORE] Found snapshot:', snapshot.id);
    console.log(`   Size: ${(Number(snapshot.sizeBytes) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Created: ${snapshot.createdAt.toISOString()}`);

    // Step 2: Download zip from R2
    console.log('☁️  [RESTORE] Downloading snapshot from R2...');
    const zipBuffer = await downloadFromR2(snapshot.s3Key);
    console.log(`✅ [RESTORE] Downloaded (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // Step 3: Upload zip to pod's tmp directory
    console.log('📤 [RESTORE] Uploading zip to pod...');
    const zipFileName = 'restore-snapshot.zip';
    // Write the buffer to a temp file in the pod
    // Note: This is a simplified approach. In production, you might want to stream this
    await executeInPod(
      projectId,
      `cat > /tmp/${zipFileName} << 'EOF'
${zipBuffer.toString('base64')}
EOF
base64 -d /tmp/${zipFileName} > /tmp/${zipFileName}.decoded
mv /tmp/${zipFileName}.decoded /tmp/${zipFileName}`
    );
    console.log('✅ [RESTORE] Zip uploaded to pod');

    // Step 4: Extract zip
    console.log('📦 [RESTORE] Extracting zip archive...');
    await executeInPod(projectId, `cd /app && unzip -o /tmp/${zipFileName}`);
    console.log('✅ [RESTORE] Archive extracted');

    // Step 5: Run npm install
    console.log('📦 [RESTORE] Installing dependencies...');
    await executeInPod(projectId, 'cd /app && npm install');
    console.log('✅ [RESTORE] Dependencies installed');

    // Step 6: Cleanup
    try {
      await executeInPod(projectId, `rm /tmp/${zipFileName}`);
    } catch (error) {
      // Ignore cleanup errors
    }

    console.log('✅ [RESTORE] Project restored successfully from snapshot');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return true;
  } catch (error: any) {
    console.error('❌ [RESTORE] Error restoring snapshot:', error);
    throw new Error(`Failed to restore snapshot: ${error.message}`);
  }
}

/**
 * Check if a project has any snapshots
 */
export async function hasProjectSnapshots(projectId: string): Promise<boolean> {
  const count = await prisma.snapshot.count({
    where: {
      projectId,
    },
  });

  return count > 0;
}
