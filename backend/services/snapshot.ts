import { executeInPod } from './kubernetes';
import { uploadToR2, downloadFromR2 } from '../utils/r2Storage';
import prisma from '../config/database';

export type SnapshotType = 'manual' | 'auto-cleanup' | 'auto-restart';

/**
 * Create a snapshot of a project
 * 1. Remove node_modules from the project
 * 2. Create a zip file
 * 3. Upload to R2
 * 4. Save snapshot record to database
 */
export async function createProjectSnapshot(
  projectId: string,
  snapshotType: SnapshotType = 'manual'
): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[SNAPSHOT] Creating snapshot for project:', projectId);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Step 1: Remove node_modules to reduce snapshot size
    console.log('[SNAPSHOT] Removing node_modules...');
    try {
      await executeInPod(projectId, 'rm -rf /app/react-templete/node_modules');
      console.log('[SNAPSHOT] node_modules removed');
    } catch (error: any) {
      console.log('[SNAPSHOT] node_modules not found or already removed');
    }

    // Step 2: Create a zip file of the project (ONLY react-templete, not the entire /app)
    console.log('[SNAPSHOT] Creating zip archive...');
    const zipFileName = `snapshot-${Date.now()}.zip`;
    await executeInPod(
      projectId,
      `cd /app/react-templete && zip -r /tmp/${zipFileName} . -x "node_modules/*" -x ".git/*" -x "dist/*" -x "build/*"`
    );
    console.log('[SNAPSHOT] Zip archive created');

    // Step 3: Get the zip file content using base64 to avoid corruption
    console.log('[SNAPSHOT] Reading zip file...');
    const zipContentBase64 = await executeInPod(projectId, `base64 /tmp/${zipFileName}`);
    const zipBuffer = Buffer.from(zipContentBase64.trim(), 'base64');
    console.log(`[SNAPSHOT] Zip file read (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // Step 4: Upload to R2
    console.log('[SNAPSHOT] Uploading to R2...');
    const uploadResult = await uploadToR2(
      zipBuffer,
      zipFileName,
      'application/zip',
      projectId
    );
    console.log('[SNAPSHOT] Uploaded to R2:', uploadResult.key);

    // Step 5: Save snapshot record to database
    console.log('[SNAPSHOT] Saving snapshot record to database...');
    const snapshot = await prisma.snapshot.create({
      data: {
        projectId,
        s3Key: uploadResult.key,
        snapshotType: 'full',
        sizeBytes: BigInt(zipBuffer.length),
      },
    });
    console.log('[SNAPSHOT] Snapshot record saved:', snapshot.id);

    // Step 6: Cleanup temp file
    try {
      await executeInPod(projectId, `rm /tmp/${zipFileName}`);
    } catch (error) {
      // Ignore cleanup errors
    }

    console.log('[SNAPSHOT] Snapshot created successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return snapshot.id;
  } catch (error: any) {
    console.error('[SNAPSHOT] Error creating snapshot:', error);
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
  console.log('[RESTORE] Restoring project from snapshot:', projectId);
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
      console.log('[RESTORE] No snapshot found for project');
      return false;
    }

    console.log('[RESTORE] Found snapshot:', snapshot.id);
    console.log(`   Size: ${(Number(snapshot.sizeBytes) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Created: ${snapshot.createdAt.toISOString()}`);

    // Step 2: Download zip from R2
    console.log('[RESTORE] Downloading snapshot from R2...');
    const zipBuffer = await downloadFromR2(snapshot.s3Key);
    console.log(`[RESTORE] Downloaded (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // Step 3: Wait for pod filesystem to be ready and upload zip
    console.log('[RESTORE] Waiting for pod filesystem to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
    console.log('[RESTORE] Filesystem should be ready');

    // Test if pod can execute simple commands
    console.log('[RESTORE] Testing pod readiness...');
    let retries = 3;
    while (retries > 0) {
      try {
        await executeInPod(projectId, 'echo "test" > /tmp/test.txt && rm /tmp/test.txt');
        console.log('[RESTORE] Pod is ready to receive commands');
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        console.log(`[RESTORE] Pod not ready, retrying... (${retries} left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Step 4: Upload zip to pod's tmp directory with retry logic
    console.log('[RESTORE] Uploading zip to pod...');
    const zipFileName = 'restore-snapshot.zip';
    const hexData = zipBuffer.toString('hex');

    retries = 3;
    while (retries > 0) {
      try {
        // First, remove any existing file
        await executeInPod(projectId, `rm -f /tmp/${zipFileName}`).catch(() => {});

        // Write hex data and convert to binary using xxd
        // Split into chunks to avoid command line length limits
        const chunkSize = 100000; // 100KB of hex per chunk
        const chunks = Math.ceil(hexData.length / chunkSize);

        console.log(`[RESTORE] Uploading in ${chunks} chunks...`);

        for (let i = 0; i < chunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, hexData.length);
          const chunk = hexData.slice(start, end);

          // Append hex chunk to file
          await executeInPod(projectId, `printf '${chunk}' >> /tmp/${zipFileName}.hex`);

          if ((i + 1) % 10 === 0 || i === chunks - 1) {
            console.log(`   Uploaded chunk ${i + 1}/${chunks}`);
          }
        }

        // Convert from hex to binary
        await executeInPod(projectId, `xxd -r -p /tmp/${zipFileName}.hex > /tmp/${zipFileName}`);

        // Remove hex file
        await executeInPod(projectId, `rm /tmp/${zipFileName}.hex`);

        // Verify file was created and has correct size
        const fileCheck = await executeInPod(projectId, `ls -lh /tmp/${zipFileName} || echo "NOTFOUND"`);
        if (fileCheck.includes('NOTFOUND')) {
          throw new Error('Zip file was not created in pod');
        }

        // Verify it's a valid zip file
        const zipCheck = await executeInPod(projectId, `unzip -t /tmp/${zipFileName} 2>&1 | head -5 || echo "INVALID"`);
        if (zipCheck.includes('INVALID') || zipCheck.includes('End-of-central-directory')) {
          console.log(`[RESTORE] Zip validation output: ${zipCheck.substring(0, 200)}`);
        }

        console.log('[RESTORE] Zip uploaded to pod');
        console.log(`   File info: ${fileCheck.trim()}`);
        break;
      } catch (error: any) {
        retries--;
        if (retries === 0) {
          console.error('[RESTORE] Failed to upload zip after all retries');
          throw error;
        }
        console.log(`[RESTORE] Upload failed, retrying... (${retries} left)`);
        console.log(`   Error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Step 5: Ensure directory exists and clean it
    console.log('[RESTORE] Preparing project directory...');
    await executeInPod(projectId, 'rm -rf /app/react-templete');
    await executeInPod(projectId, 'mkdir -p /app/react-templete');
    console.log('[RESTORE] Clean directory created at /app/react-templete');

    // Step 6: Test zip file integrity before extraction
    console.log('🔍 [RESTORE] Testing zip file integrity...');
    try {
      const zipTest = await executeInPod(projectId, `unzip -t /tmp/${zipFileName} 2>&1 | tail -1`);
      console.log(`   Zip test result: ${zipTest.trim()}`);
      if (zipTest.includes('No errors detected')) {
        console.log('[RESTORE] Zip file integrity verified');
      } else {
        console.log(`[RESTORE] Zip test output: ${zipTest}`);
      }
    } catch (error: any) {
      console.error('[RESTORE] Zip integrity test failed:', error.message);
      throw new Error('Zip file is corrupted');
    }

    // Step 7: Extract zip archive
    console.log('[RESTORE] Extracting zip archive to /app/react-templete...');
    try {
      // List what's in the zip first
      const zipList = await executeInPod(projectId, `unzip -l /tmp/${zipFileName} | head -20`);
      console.log('   Zip contents preview:', zipList.substring(0, 300));

      // Extract to /app/react-templete
      const extractOutput = await executeInPod(projectId, `cd /app/react-templete && unzip -o /tmp/${zipFileName} 2>&1`);
      console.log('[RESTORE] Archive extracted');
      console.log('   Extract output:', extractOutput.substring(0, 200));
    } catch (error: any) {
      console.error('[RESTORE] Extraction failed:', error.message);
      throw new Error('Failed to extract snapshot archive');
    }

    // Step 8: Verify extraction worked and show directory structure
    console.log('🔍 [RESTORE] Verifying extraction...');

    // Check for package.json
    const packageJsonCheck = await executeInPod(projectId, 'ls -la /app/react-templete/package.json 2>&1');
    if (packageJsonCheck.includes('No such file')) {
      console.error('[RESTORE] package.json not found at /app/react-templete/package.json!');

      // Debug: show what's actually in the directory
      const dirContents = await executeInPod(projectId, 'ls -la /app/react-templete/');
      console.error('   Directory contents:', dirContents);

      throw new Error('Snapshot extraction failed - package.json not found');
    }
    console.log('[RESTORE] package.json found at /app/react-templete/package.json');

    // Show directory structure
    const dirStructure = await executeInPod(projectId, 'ls -la /app/react-templete/ | head -10');
    console.log('   Directory structure:', dirStructure);

    // Step 9: Run npm install in the project directory
    console.log('[RESTORE] Installing dependencies in /app/react-templete...');
    try {
      // Verify we're in the right directory
      const pwd = await executeInPod(projectId, 'cd /app/react-templete && pwd');
      console.log(`   Working directory: ${pwd.trim()}`);

      // Run npm install
      const npmOutput = await executeInPod(projectId, 'cd /app/react-templete && npm install 2>&1');
      console.log('[RESTORE] Dependencies installed');

      // Show last few lines of npm output
      const npmLines = npmOutput.split('\n').slice(-5).join('\n');
      console.log('   npm install output (last 5 lines):', npmLines);
    } catch (error: any) {
      console.error('[RESTORE] npm install failed:', error.message);
      throw new Error('Failed to install dependencies');
    }

    // Step 10: Cleanup
    try {
      await executeInPod(projectId, `rm -f /tmp/${zipFileName} /tmp/${zipFileName}.hex`);
      console.log('[RESTORE] Cleanup completed');
    } catch (error) {
      console.log('[RESTORE] Cleanup failed (non-critical)');
    }

    console.log('[RESTORE] Project restored successfully from snapshot');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return true;
  } catch (error: any) {
    console.error('[RESTORE] Error restoring snapshot:', error);
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
