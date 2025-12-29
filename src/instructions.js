function createDeployInstruction(walletPublicKey, automationAddress, boardAddress, configAddress, minerAddress, roundAddress, entropyVarAddress, amount, tileIndices) {
    const squares = Array(25).fill(false);
    tileIndices.forEach(index => {
        squares[index] = true;
    });
    
    let mask = 0;
    for (let i = 0; i < 25; i++) {
        if (squares[i]) {
            mask |= 1 << i;
        }
    }
    
    const data = new Uint8Array(13);
    const view = new DataView(data.buffer);
    data[0] = DEPLOY_DISCRIMINATOR;
    view.setBigUint64(1, BigInt(Math.floor(amount * LAMPORTS_PER_SOL)), true);
    view.setUint32(9, mask, true);
    
    return new solanaWeb3.TransactionInstruction({
        keys: [
            { pubkey: walletPublicKey, isSigner: true, isWritable: true },
            { pubkey: walletPublicKey, isSigner: false, isWritable: true },
            { pubkey: automationAddress, isSigner: false, isWritable: true },
            { pubkey: boardAddress, isSigner: false, isWritable: true },
            { pubkey: configAddress, isSigner: false, isWritable: true },
            { pubkey: minerAddress, isSigner: false, isWritable: true },
            { pubkey: roundAddress, isSigner: false, isWritable: true },
            { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new solanaWeb3.PublicKey(PROGRAM_ID), isSigner: false, isWritable: false },
            { pubkey: entropyVarAddress, isSigner: false, isWritable: true },
            { pubkey: new solanaWeb3.PublicKey(ENTROPY_PROGRAM_ID), isSigner: false, isWritable: false }
        ],
        programId: new solanaWeb3.PublicKey(PROGRAM_ID),
        data: data
    });
}

function createClaimSolInstruction(walletPublicKey, minerAddress) {
    const data = new Uint8Array(1);
    data[0] = CLAIM_SOL_DISCRIMINATOR;
    
    return new solanaWeb3.TransactionInstruction({
        keys: [
            { pubkey: walletPublicKey, isSigner: true, isWritable: true },
            { pubkey: minerAddress, isSigner: false, isWritable: true },
            { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: new solanaWeb3.PublicKey(PROGRAM_ID),
        data: data
    });
}

function createCheckpointInstruction(walletPublicKey, boardAddress, minerAddress, roundAddress, treasuryAddress) {
    const data = new Uint8Array(1);
    data[0] = CHECKPOINT_DISCRIMINATOR;
    
    return new solanaWeb3.TransactionInstruction({
        keys: [
            { pubkey: walletPublicKey, isSigner: true, isWritable: true },
            { pubkey: boardAddress, isSigner: false, isWritable: true },
            { pubkey: minerAddress, isSigner: false, isWritable: true },
            { pubkey: roundAddress, isSigner: false, isWritable: true },
            { pubkey: treasuryAddress, isSigner: false, isWritable: true },
            { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: new solanaWeb3.PublicKey(PROGRAM_ID),
        data: data
    });
}

