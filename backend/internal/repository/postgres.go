package repository

import (
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"gorm.io/gorm"
)

type PostgresAPIKeyRepo struct {
	db *gorm.DB
}

func NewPostgresAPIKeyRepo(db *gorm.DB) *PostgresAPIKeyRepo {
	return &PostgresAPIKeyRepo{db: db}
}

func (r *PostgresAPIKeyRepo) Create(apiKey *domain.APIKey) error {
	return r.db.Create(apiKey).Error
}

func (r *PostgresAPIKeyRepo) GetByID(id uuid.UUID) (*domain.APIKey, error) {
	var apiKey domain.APIKey
	if err := r.db.Take(&apiKey, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &apiKey, nil
}

func (r *PostgresAPIKeyRepo) GetByHash(hash string) (*domain.APIKey, error) {
	var apiKey domain.APIKey
	if err := r.db.Take(&apiKey, "key_hash = ?", hash).Error; err != nil {
		return nil, err
	}
	return &apiKey, nil
}

func (r *PostgresAPIKeyRepo) ListByUserID(userID uuid.UUID) ([]domain.APIKey, error) {
	var apiKeys []domain.APIKey
	if err := r.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&apiKeys).Error; err != nil {
		return nil, err
	}
	return apiKeys, nil
}

func (r *PostgresAPIKeyRepo) ListByPrefix(prefix string) ([]domain.APIKey, error) {
	var apiKeys []domain.APIKey
	if err := r.db.Where("key_prefix = ?", prefix).Find(&apiKeys).Error; err != nil {
		return nil, err
	}
	return apiKeys, nil
}

func (r *PostgresAPIKeyRepo) Delete(id uuid.UUID) error {
	return r.db.Delete(&domain.APIKey{}, "id = ?", id).Error
}

func (r *PostgresAPIKeyRepo) UpdateLastUsed(id uuid.UUID) error {
	now := time.Now()
	return r.db.Model(&domain.APIKey{}).Where("id = ?", id).Update("last_used", &now).Error
}

type PostgresNamespaceRepo struct {
	db *gorm.DB
}

func NewPostgresNamespaceRepo(db *gorm.DB) *PostgresNamespaceRepo {
	return &PostgresNamespaceRepo{db: db}
}

func applyScope(db *gorm.DB, scope *domain.PermissionScope, tagJoinTable, resourceIDCol string) *gorm.DB {
	if scope == nil || scope.IsGlobal {
		return db
	}

	conds := db.Where("id IN ?", scope.AllowedItemIDs)

	if len(scope.AllowedNamespaceIDs) > 0 {
		conds = conds.Or("namespace_id IN ?", scope.AllowedNamespaceIDs)
	}

	if tagJoinTable != "" && resourceIDCol != "" && len(scope.AllowedTagIDs) > 0 {
		subQuery := db.Table(tagJoinTable).Select(resourceIDCol).Where("tag_id IN ?", scope.AllowedTagIDs)
		conds = conds.Or("id IN (?)", subQuery)
	}

	return db.Where(conds)
}

func (r *PostgresNamespaceRepo) Create(ns *domain.Namespace) error {
	return r.db.Create(ns).Error
}

func (r *PostgresNamespaceRepo) GetByID(id uuid.UUID, scope *domain.PermissionScope) (*domain.Namespace, error) {
	var ns domain.Namespace
	db := r.db
	if scope != nil && !scope.IsGlobal {
		// Namespaces only filter by their own IDs
		db = db.Where("id IN ?", scope.AllowedItemIDs)
	}
	if err := db.Take(&ns, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &ns, nil
}

func (r *PostgresNamespaceRepo) List(scope *domain.PermissionScope) ([]domain.Namespace, error) {
	var nss []domain.Namespace
	db := r.db
	if scope != nil && !scope.IsGlobal {
		db = db.Where("id IN ?", scope.AllowedItemIDs)
	}
	if err := db.Order("created_at DESC").Find(&nss).Error; err != nil {
		return nil, err
	}
	return nss, nil
}

func (r *PostgresNamespaceRepo) Update(ns *domain.Namespace) error {
	return r.db.Save(ns).Error
}

func (r *PostgresNamespaceRepo) Delete(id uuid.UUID) error {
	return r.db.Delete(&domain.Namespace{}, "id = ?", id).Error
}

type PostgresUserRepo struct {
	db *gorm.DB
}

func NewPostgresUserRepo(db *gorm.DB) *PostgresUserRepo {
	return &PostgresUserRepo{db: db}
}

func (r *PostgresUserRepo) Create(user *domain.User) error {
	return r.db.Create(user).Error
}

func (r *PostgresUserRepo) GetByID(id uuid.UUID) (*domain.User, error) {
	var user domain.User
	if err := r.db.Preload("Roles.Permissions.Permission").Preload("Permissions").Take(&user, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *PostgresUserRepo) GetByUsername(username string) (*domain.User, error) {
	var user domain.User
	if err := r.db.Preload("Roles.Permissions.Permission").Preload("Permissions").Take(&user, "username = ?", username).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *PostgresUserRepo) GetByEmail(email string) (*domain.User, error) {
	var user domain.User
	if err := r.db.Preload("Roles.Permissions.Permission").Preload("Permissions").Take(&user, "LOWER(email) = LOWER(?)", email).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *PostgresUserRepo) GetBySocialID(provider, socialID string) (*domain.User, error) {
	var user domain.User
	if err := r.db.Preload("Roles.Permissions.Permission").Preload("Permissions").
		Take(&user, "social_provider = ? AND social_id = ?", provider, socialID).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *PostgresUserRepo) List() ([]domain.User, error) {
	var users []domain.User
	if err := r.db.Preload("Roles").Order("created_at DESC").Find(&users).Error; err != nil {
		return nil, err
	}
	return users, nil
}

func (r *PostgresUserRepo) ListPaginated(limit, offset int, searchTerm string, roleID *uuid.UUID) ([]domain.User, int64, error) {
	var users []domain.User
	var total int64
	db := r.db.Model(&domain.User{})

	if searchTerm != "" {
		s := "%" + searchTerm + "%"
		db = db.Where("username ILIKE ? OR email ILIKE ?", s, s)
	}

	if roleID != nil {
		db = db.Joins("JOIN user_roles ON user_roles.user_id = users.id").Where("user_roles.role_id = ?", roleID)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := db.Preload("Roles").Limit(limit).Offset(offset).Order("created_at DESC").Find(&users).Error
	return users, total, err
}

func (r *PostgresUserRepo) Update(user *domain.User) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Sync Roles many-to-many
		if user.Roles != nil {
			if err := tx.Model(user).Association("Roles").Replace(user.Roles); err != nil {
				return err
			}
		}

		// Sync Permissions many-to-many
		if user.Permissions != nil {
			if err := tx.Model(user).Association("Permissions").Replace(user.Permissions); err != nil {
				return err
			}
		}

		// Update top-level fields (omit associations to avoid double-processing)
		return tx.Omit("Roles", "Permissions").Save(user).Error
	})
}

func (r *PostgresUserRepo) Delete(id uuid.UUID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var user domain.User
		if err := tx.Take(&user, "id = ?", id).Error; err != nil {
			return err
		}

		// Prefix username to allow reuse of the original username
		newUsername := "deleted_" + strconv.FormatInt(time.Now().Unix(), 10) + "_" + user.Username
		if err := tx.Model(&user).Update("username", newUsername).Error; err != nil {
			return err
		}

		return tx.Delete(&user).Error
	})
}

func (r *PostgresUserRepo) SetRoles(userID uuid.UUID, roles []domain.Role) error {
	return r.db.Model(&domain.User{ID: userID}).Association("Roles").Replace(roles)
}

type PostgresDomainRoleMappingRepo struct {
	db *gorm.DB
}

func NewPostgresDomainRoleMappingRepo(db *gorm.DB) *PostgresDomainRoleMappingRepo {
	return &PostgresDomainRoleMappingRepo{db: db}
}

func (r *PostgresDomainRoleMappingRepo) Create(mapping *domain.DomainRoleMapping) error {
	return r.db.Create(mapping).Error
}

func (r *PostgresDomainRoleMappingRepo) GetByID(id uuid.UUID) (*domain.DomainRoleMapping, error) {
	var mapping domain.DomainRoleMapping
	if err := r.db.Preload("Role").Take(&mapping, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &mapping, nil
}

func (r *PostgresDomainRoleMappingRepo) GetByDomain(domainName string) (*domain.DomainRoleMapping, error) {
	var mapping domain.DomainRoleMapping
	if err := r.db.Preload("Role").Take(&mapping, "LOWER(domain) = LOWER(?)", domainName).Error; err != nil {
		return nil, err
	}
	return &mapping, nil
}

func (r *PostgresDomainRoleMappingRepo) List() ([]domain.DomainRoleMapping, error) {
	var mappings []domain.DomainRoleMapping
	if err := r.db.Preload("Role").Order("domain ASC").Find(&mappings).Error; err != nil {
		return nil, err
	}
	return mappings, nil
}

func (r *PostgresDomainRoleMappingRepo) Update(mapping *domain.DomainRoleMapping) error {
	// Omit Role so a payload carrying the preloaded association does not upsert the role itself.
	return r.db.Omit("Role").Save(mapping).Error
}

func (r *PostgresDomainRoleMappingRepo) Delete(id uuid.UUID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var mapping domain.DomainRoleMapping
		if err := tx.Take(&mapping, "id = ?", id).Error; err != nil {
			return err
		}

		// The unique index on domain covers soft-deleted rows too, so the name is
		// prefixed on delete to keep the domain re-addable (same trick as users/roles).
		newDomain := "deleted_" + strconv.FormatInt(time.Now().Unix(), 10) + "_" + mapping.Domain
		if err := tx.Model(&mapping).Update("domain", newDomain).Error; err != nil {
			return err
		}

		return tx.Delete(&mapping).Error
	})
}

type PostgresRoleRepo struct {
	db *gorm.DB
}

func NewPostgresRoleRepo(db *gorm.DB) *PostgresRoleRepo {
	return &PostgresRoleRepo{db: db}
}

func (r *PostgresRoleRepo) Create(role *domain.Role) error {
	return r.db.Create(role).Error
}

func (r *PostgresRoleRepo) GetByID(id uuid.UUID) (*domain.Role, error) {
	var role domain.Role
	if err := r.db.Preload("Permissions.Permission").Take(&role, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

func (r *PostgresRoleRepo) List() ([]domain.Role, error) {
	var roles []domain.Role
	if err := r.db.Preload("Permissions.Permission").Order("created_at DESC").Find(&roles).Error; err != nil {
		return nil, err
	}
	return roles, nil
}

func (r *PostgresRoleRepo) ListPaginated(limit, offset int, searchTerm string) ([]domain.Role, int64, error) {
	var roles []domain.Role
	var total int64
	db := r.db.Model(&domain.Role{})

	if searchTerm != "" {
		s := "%" + searchTerm + "%"
		db = db.Where("name ILIKE ? OR description ILIKE ?", s, s)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := db.Preload("Permissions.Permission").Limit(limit).Offset(offset).Order("created_at DESC").Find(&roles).Error
	return roles, total, err
}

func (r *PostgresRoleRepo) Update(role *domain.Role) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Sync Permissions (role_permissions table)
		if role.Permissions != nil {
			if err := tx.Model(role).Association("Permissions").Replace(role.Permissions); err != nil {
				return err
			}
		}

		// Update top-level fields (omit associations)
		return tx.Omit("Permissions").Save(role).Error
	})
}

func (r *PostgresRoleRepo) Delete(id uuid.UUID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var role domain.Role
		if err := tx.Take(&role, "id = ?", id).Error; err != nil {
			return err
		}

		// Prefix name to allow reuse
		newName := "deleted_" + strconv.FormatInt(time.Now().Unix(), 10) + "_" + role.Name
		if err := tx.Model(&role).Update("name", newName).Error; err != nil {
			return err
		}

		return tx.Delete(&role).Error
	})
}

func (r *PostgresRoleRepo) GetByIDs(ids []uuid.UUID) ([]domain.Role, error) {
	var roles []domain.Role
	err := r.db.Where("id IN ?", ids).Find(&roles).Error
	return roles, err
}

func (r *PostgresRoleRepo) SetPermissions(roleID uuid.UUID, rolePerms []domain.RolePermission) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Clear existing permissions
		if err := tx.Where("role_id = ?", roleID).Delete(&domain.RolePermission{}).Error; err != nil {
			return err
		}
		// Insert new permissions
		for _, rp := range rolePerms {
			rp.RoleID = roleID
			if err := tx.Create(&rp).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

type PostgresPermissionRepo struct {
	db *gorm.DB
}

func NewPostgresPermissionRepo(db *gorm.DB) *PostgresPermissionRepo {
	return &PostgresPermissionRepo{db: db}
}

func (r *PostgresPermissionRepo) Create(perm *domain.Permission) error {
	return r.db.Create(perm).Error
}

func (r *PostgresPermissionRepo) List() ([]domain.Permission, error) {
	var perms []domain.Permission
	if err := r.db.Order("created_at DESC").Find(&perms).Error; err != nil {
		return nil, err
	}
	return perms, nil
}

func (r *PostgresPermissionRepo) Delete(id uuid.UUID) error {
	return r.db.Delete(&domain.Permission{}, "id = ?", id).Error
}

func (r *PostgresPermissionRepo) GetByIDs(ids []uuid.UUID) ([]domain.Permission, error) {
	var perms []domain.Permission
	err := r.db.Where("id IN ?", ids).Find(&perms).Error
	return perms, err
}

type PostgresSystemSettingRepo struct {
	db *gorm.DB
}

func NewPostgresSystemSettingRepo(db *gorm.DB) *PostgresSystemSettingRepo {
	return &PostgresSystemSettingRepo{db: db}
}

func (r *PostgresSystemSettingRepo) GetByKey(key string) (*domain.SystemSetting, error) {
	var setting domain.SystemSetting
	if err := r.db.Take(&setting, "key = ?", key).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

func (r *PostgresSystemSettingRepo) Upsert(setting *domain.SystemSetting) error {
	var existing domain.SystemSetting
	if err := r.db.Take(&existing, "key = ?", setting.Key).Error; err == nil {
		setting.ID = existing.ID
		return r.db.Save(setting).Error
	}
	if setting.ID == uuid.Nil {
		setting.ID = uuid.New()
	}
	return r.db.Create(setting).Error
}

func (r *PostgresSystemSettingRepo) List() ([]domain.SystemSetting, error) {
	var settings []domain.SystemSetting
	if err := r.db.Find(&settings).Error; err != nil {
		return nil, err
	}
	return settings, nil
}
