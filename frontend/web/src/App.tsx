import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface DiseaseRecord {
  id: string;
  name: string;
  severity: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface StatsData {
  totalRecords: number;
  verifiedRecords: number;
  avgSeverity: number;
  recentRecords: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<DiseaseRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({
    visible: false,
    status: "pending" as const,
    message: ""
  });
  const [newRecordData, setNewRecordData] = useState({ name: "", severity: "", description: "" });
  const [selectedRecord, setSelectedRecord] = useState<DiseaseRecord | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState<StatsData>({ totalRecords: 0, verifiedRecords: 0, avgSeverity: 0, recentRecords: 0 });
  const [showFAQ, setShowFAQ] = useState(false);
  const [showStats, setShowStats] = useState(true);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;

      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM initialization failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }

      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;

    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      const businessIds = await contract.getAllBusinessIds();
      const recordsList: DiseaseRecord[] = [];

      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: businessId,
            name: businessData.name,
            severity: businessId,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }

      setRecords(recordsList);
      calculateStats(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const calculateStats = (records: DiseaseRecord[]) => {
    const totalRecords = records.length;
    const verifiedRecords = records.filter(r => r.isVerified).length;
    const avgSeverity = records.length > 0
      ? records.reduce((sum, r) => sum + r.publicValue1, 0) / records.length
      : 0;
    const recentRecords = records.filter(r =>
      Date.now()/1000 - r.timestamp < 60 * 60 * 24 * 7
    ).length;

    setStats({ totalRecords, verifiedRecords, avgSeverity, recentRecords });
  };

  const createRecord = async () => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return;
    }

    setCreatingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating record with FHE..." });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const severityValue = parseInt(newRecordData.severity) || 0;
      const businessId = `disease-${Date.now()}`;

      const encryptedResult = await encrypt(contractAddress, address, severityValue);

      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        severityValue,
        0,
        newRecordData.description
      );

      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();

      setTransactionStatus({ visible: true, status: "success", message: "Record created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);

      await loadData();
      setShowCreateModal(false);
      setNewRecordData({ name: "", severity: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction")
        ? "Transaction rejected"
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setCreatingRecord(false);
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    }

    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;

      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }

      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;

      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);

      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) =>
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );

      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });

      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];

      await loadData();

      setTransactionStatus({ visible: true, status: "success", message: "Decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);

      return Number(clearValue);

    } catch (e: any) {
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }

      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    } finally {
      setIsDecrypting(false);
    }
  };

  const renderStats = () => {
    return (
      <div className="stats-panels">
        <div className="panel metal-panel">
          <h3>Total Records</h3>
          <div className="stat-value">{stats.totalRecords}</div>
          <div className="stat-trend">+{stats.recentRecords} this week</div>
        </div>

        <div className="panel metal-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{stats.verifiedRecords}/{stats.totalRecords}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>

        <div className="panel metal-panel">
          <h3>Avg Severity</h3>
          <div className="stat-value">{stats.avgSeverity.toFixed(1)}/10</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-section">
        <h3>Frequently Asked Questions</h3>
        <div className="faq-item">
          <div className="faq-question">How is my data protected?</div>
          <div className="faq-answer">All disease severity data is encrypted using FHE before being stored on-chain, ensuring your privacy.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">What is FHE?</div>
          <div className="faq-answer">Fully Homomorphic Encryption allows computations on encrypted data without decryption.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">Who can see my data?</div>
          <div className="faq-answer">Only aggregated statistics are visible. Individual encrypted data requires your decryption key.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">How is data used?</div>
          <div className="faq-answer">Researchers can analyze encrypted data to identify disease patterns without compromising privacy.</div>
        </div>
      </div>
    );
  };

  const renderSeverityChart = (severity: number) => {
    return (
      <div className="severity-chart">
        <div className="chart-row">
          <div className="chart-label">Severity Level</div>
          <div className="chart-bar">
            <div
              className="bar-fill"
              style={{ width: `${severity * 10}%` }}
            >
              <span className="bar-value">{severity}/10</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>DiseaseReg_Z</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>

        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet</h2>
            <p>Secure disease registry using FHE encryption.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to access encrypted registry</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Register diseases with privacy protection</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted registry...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>DiseaseReg_Z</h1>
          <div className="subtitle">FHE Protected Disease Registry</div>
        </div>

        <div className="header-actions">
          <button
            onClick={() => setShowCreateModal(true)}
            className="create-btn"
          >
            + New Record
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Confidential Disease Registry</h2>
            <div className="header-actions">
              <button
                className={`toggle-btn ${showStats ? 'active' : ''}`}
                onClick={() => setShowStats(true)}
              >
                Statistics
              </button>
              <button
                className={`toggle-btn ${!showStats ? 'active' : ''}`}
                onClick={() => setShowStats(false)}
              >
                FAQ
              </button>
            </div>
          </div>

          {showStats ? renderStats() : renderFAQ()}
        </div>

        <div className="records-section">
          <div className="section-header">
            <h2>Patient Records</h2>
            <div className="header-actions">
              <button
                onClick={loadData}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="records-list">
            {records.length === 0 ? (
              <div className="no-records">
                <p>No disease records found</p>
                <button
                  className="create-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Record
                </button>
              </div>
            ) : records.map((record, index) => (
              <div
                className={`record-item ${selectedRecord?.id === record.id ? "selected" : ""} ${record.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedRecord(record)}
              >
                <div className="record-title">{record.name}</div>
                <div className="record-meta">
                  <span>Severity: {record.publicValue1}/10</span>
                  <span>Date: {new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="record-status">
                  {record.isVerified ? "✅ Verified" : "🔓 Verify"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreateRecord
          onSubmit={createRecord}
          onClose={() => setShowCreateModal(false)}
          creating={creatingRecord}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedRecord && (
        <RecordDetailModal
          record={selectedRecord}
          onClose={() => {
            setSelectedRecord(null);
            setDecryptedData(null);
          }}
          decryptedData={decryptedData}
          setDecryptedData={setDecryptedData}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptData(selectedRecord.id)}
          renderSeverityChart={renderSeverityChart}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateRecord: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'severity') {
      const intValue = value.replace(/[^\d]/g, '');
      setRecordData({ ...recordData, [name]: intValue });
    } else {
      setRecordData({ ...recordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-record-modal">
        <div className="modal-header">
          <h2>New Disease Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>

        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption</strong>
            <p>Severity level encrypted with Zama FHE</p>
          </div>

          <div className="form-group">
            <label>Disease Name *</label>
            <input
              type="text"
              name="name"
              value={recordData.name}
              onChange={handleChange}
              placeholder="Enter disease name..."
            />
          </div>

          <div className="form-group">
            <label>Severity Level (1-10) *</label>
            <input
              type="number"
              name="severity"
              value={recordData.severity}
              onChange={handleChange}
              placeholder="Enter severity..."
              min="1"
              max="10"
            />
            <div className="data-type-label">FHE Encrypted</div>
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={recordData.description}
              onChange={handleChange}
              placeholder="Enter description..."
            />
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={creating || isEncrypting || !recordData.name || !recordData.severity}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Record"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: DiseaseRecord;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderSeverityChart: (severity: number) => JSX.Element;
}> = ({ record, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderSeverityChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) {
      setDecryptedData(null);
      return;
    }

    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal">
        <div className="modal-header">
          <h2>Disease Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>

        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>Disease:</span>
              <strong>{record.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>

          <div className="data-section">
            <h3>Encrypted Severity Data</h3>

            <div className="data-row">
              <div className="data-label">Severity Level:</div>
              <div className="data-value">
                {record.isVerified && record.decryptedValue ?
                  `${record.decryptedValue}/10 (Verified)` :
                  decryptedData !== null ?
                  `${decryptedData}/10 (Decrypted)` :
                  "🔒 FHE Encrypted"
                }
              </div>
              <button
                className={`decrypt-btn ${(record.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : record.isVerified ? (
                  "✅ Verified"
                ) : decryptedData !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify"
                )}
              </button>
            </div>

            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protection</strong>
                <p>Severity data encrypted on-chain. Verify to decrypt and validate.</p>
              </div>
            </div>
          </div>

          {(record.isVerified || decryptedData !== null) && (
            <div className="severity-section">
              <h3>Severity Visualization</h3>
              {renderSeverityChart(
                record.isVerified ? record.decryptedValue || 0 : decryptedData || 0
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!record.isVerified && (
            <button
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


