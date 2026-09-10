package repository

import (
	"log"

	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"github.com/user/csm-backend/pkg/crypto"
	"gorm.io/gorm"
)

type PostgresGlobalVariableRepo struct {
	db *gorm.DB
}

func NewPostgresGlobalVariableRepo(db *gorm.DB) *PostgresGlobalVariableRepo {
	return &PostgresGlobalVariableRepo{db: db}
}

// encryptSecret encrypts the value of a variable marked secret, leaving ordinary
// variables as plain text so the variables screen and search keep working. The error is
// returned rather than ignored: silently storing an unencrypted secret is worse than
// refusing the write.
func encryptSecret(gv *domain.GlobalVariable) error {
	if gv == nil || !gv.IsSecret || gv.Value == "" {
		return nil
	}
	enc, err := crypto.Encrypt(gv.Value)
	if err != nil {
		return err
	}
	gv.Value = enc
	return nil
}

// decryptSecret reverses encryptSecret. The workflow executor reads variables through
// this repository, so it keeps receiving usable plain text. A failure here usually means
// DATA_ENCRYPTION_KEY changed; the ciphertext is left untouched so nothing is destroyed,
// and the operator gets a log line instead of a workflow that silently uses ciphertext.
func decryptSecret(gv *domain.GlobalVariable) {
	if gv == nil || !gv.IsSecret || gv.Value == "" {
		return
	}
	dec, err := crypto.Decrypt(gv.Value)
	if err != nil {
		log.Printf("[GlobalVariable] cannot decrypt secret %q (id=%s): %v", gv.Key, gv.ID, err)
		return
	}
	gv.Value = dec
}

func (r *PostgresGlobalVariableRepo) Create(gv *domain.GlobalVariable) error {
	if err := encryptSecret(gv); err != nil {
		return err
	}
	if err := r.db.Create(gv).Error; err != nil {
		return err
	}
	decryptSecret(gv)
	return nil
}

func (r *PostgresGlobalVariableRepo) GetByID(id uuid.UUID, scope *domain.PermissionScope) (*domain.GlobalVariable, error) {
	var gv domain.GlobalVariable
	db := applyScope(r.db, scope, "", "")
	if err := db.Take(&gv, "id = ?", id).Error; err != nil {
		return nil, err
	}
	decryptSecret(&gv)
	return &gv, nil
}

func (r *PostgresGlobalVariableRepo) List(namespaceID uuid.UUID, scope *domain.PermissionScope) ([]domain.GlobalVariable, error) {
	var gvs []domain.GlobalVariable
	db := applyScope(r.db, scope, "", "")
	if err := db.Where("namespace_id = ?", namespaceID).Order("created_at DESC").Find(&gvs).Error; err != nil {
		return nil, err
	}
	for i := range gvs {
		decryptSecret(&gvs[i])
	}
	return gvs, nil
}

func (r *PostgresGlobalVariableRepo) ListPaginated(namespaceID uuid.UUID, limit, offset int, searchTerm string, createdBy *uuid.UUID, scope *domain.PermissionScope) ([]domain.GlobalVariable, int64, error) {
	var gvs []domain.GlobalVariable
	var total int64

	db := applyScope(r.db, scope, "", "")
	db = db.Model(&domain.GlobalVariable{}).Where("namespace_id = ?", namespaceID)

	if createdBy != nil {
		db = db.Where("created_by = ?", createdBy)
	}

	if searchTerm != "" {
		db = db.Where("key ILIKE ? OR description ILIKE ?", "%"+searchTerm+"%", "%"+searchTerm+"%")
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := db.Limit(limit).Offset(offset).Order("created_at desc").Find(&gvs).Error
	for i := range gvs {
		decryptSecret(&gvs[i])
	}
	return gvs, total, err
}

func (r *PostgresGlobalVariableRepo) ListGlobalPaginated(limit, offset int, searchTerm string, scope *domain.PermissionScope) ([]domain.GlobalVariable, int64, error) {
	var gvs []domain.GlobalVariable
	var total int64
	db := applyScope(r.db, scope, "", "") // Global variables don't have tags
	db = db.Model(&domain.GlobalVariable{})

	if searchTerm != "" {
		db = db.Where("key ILIKE ? OR value ILIKE ? OR description ILIKE ?", "%"+searchTerm+"%", "%"+searchTerm+"%", "%"+searchTerm+"%")
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := db.Limit(limit).Offset(offset).Order("created_at DESC").Find(&gvs).Error
	for i := range gvs {
		decryptSecret(&gvs[i])
	}
	return gvs, total, err
}

func (r *PostgresGlobalVariableRepo) Update(gv *domain.GlobalVariable) error {
	if err := encryptSecret(gv); err != nil {
		return err
	}
	if err := r.db.Save(gv).Error; err != nil {
		return err
	}
	decryptSecret(gv)
	return nil
}

func (r *PostgresGlobalVariableRepo) Delete(id uuid.UUID) error {
	return r.db.Delete(&domain.GlobalVariable{}, "id = ?", id).Error
}
